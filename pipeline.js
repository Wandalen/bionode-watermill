'use strict'

// === WATERWHEEL ===
const { spawn } = require('child_process')
const globby = require('globby')

// mostly for instanceof checks inside task
class File {
  constructor(value) {
    this.value = value
  }
}

const task = (props, cb) => (next) => () => {
  console.log('Starting a task')
  let { input, output } = props

  // TODO recursively traverse object
  // TODO use generators to yield Promises to be cleaner
  if (input instanceof File) {
    // If we got special classes as input, they are either stdin or files,
    // so we need to resolve the pattern
    globby(input.value)
      .then((data) => {
        // TODO unhardcoded to one file
        props.input = data[0]
        return ready()
      })
  } else if (input instanceof Array && input[0] instanceof File) {
    input = input.map(file => file.value)
    globby(input).then((data) => {
      console.log(data)
      props.input = data
      return ready()
    })
  } else {
    return ready()
  }

  function ready() {
    const stream = cb(props)

    let ended = false

    const handleFinish = () => {
      if (!ended) {
        ended = true
      } else {
        // Don't start shell process more than once
        return null
      }

      let length = 1

      if (typeof(output) === 'string') {
        length = 1
      } else if (output instanceof File) {
        output = output.value
        length = 1
      } else if (output instanceof Array && output[0] instanceof File) {
        output = output.map(file => file.value)
        length = output.length
      }

      globby(output).then((data) => {
        console.log('Wanted: ')
        console.log(output)
        console.log(data.length === length ? 'File(s) produced as expected: ' : 'File(s) not created: ')
        console.log(data)
        next()
      })
    }

    // Check current dir for files matching the pattern provided to the task
    // Then call next task in the pipeline with the resolved files
    stream.on('end', handleFinish)
    // fs.createWriteStream throws finish
    stream.on('finish', handleFinish)
    // bash processes
    stream.on('close', handleFinish)

    return stream
  }
}

function join(...tasks) {
  // hack to work for parallel
  if (tasks[0] instanceof Array) {
    tasks = tasks[0]
  }

  // return tasks.reduceRight((prev, curr) => curr(prev()))
  let result = tasks[tasks.length-1]()
  for (let i=tasks.length-2; i>=0; i--) {
    result = tasks[i](result)
  }
  return result

  // return tasks[0](tasks[1](tasks[2]()))
  // // return tasks.reduce( (prev, curr) => prev(curr()) )
  // return tasks.reduce((prev, curr, index, arr) => {
  //   console.log(prev)
  //   console.log(curr)
  //   console.log(index)
  //   return prev(curr())
  // })
  // combined({}, () => console.log('after'))
}

function parallel({ taskLists, next }) {
  let max = taskLists.length
  let count = 0

  function after() {
    return task(
    {
      input: null,
      output: null
    },
    () => {
      count++
      if (count === max) {
        console.log('PARALLEL FINISHED')
        next()()
      }
    }
    )()
  }

  const joinedTasks = []

  taskLists.forEach(taskList => {
    taskList.push(after)
    joinedTasks.push(join(taskList))
  })

  // Start parallel tasks
  return () => {
    joinedTasks.forEach(task => task())
  }
}

const shell = (cmd, opts = {}) => {
  console.log('Starting: ' + cmd)
  cmd = cmd.split(' ')

  const process = spawn(cmd[0], cmd.slice(1), Object.assign(opts, { shell: true }))

  process.stdout.on('data', (data) => console.log(`stdout: ${data}`) )

  process.stderr.on('data', (data) => console.log(`stderr: ${data}`) )

  process.on('close', (code) => console.log(`child process exited with code ${code}`) )

  return process
}

// === UTILS ===
const last = (str, sep) => {
  const splitted = str.split(sep)
  return splitted[splitted.length - 1]
}

// === PIPELINE ===
const fs = require('fs')
const ncbi = require('bionode-ncbi')
const request = require('request')

const THREADS = 4
const config = {
  sraAccession: '2492428',
  referenceURL: 'http://ftp.ncbi.nlm.nih.gov/genomes/all/GCA_000988525.2_ASM98852v2/GCA_000988525.2_ASM98852v2_genomic.fna.gz'
}


// thunk'it here or inside task?
// const/let does not get hoisted, and it is unnatural to describe pipelines
// in reverse order:
// const task2 = task(...)
// const task1 = task(,,task2)
// functions do get hoisted, but then we have a somewhat less pretty indented
// return task(...) boilerplate

// const samples = task(...)
// const samples = () => task(...)
function samples(next) {
  // task(props, cb)(next)
  return task(
    // these params are then made available to the cb
    {
      input: {
        db: 'sra',
        accession: config.sraAccession
      },
      // will be globby'ed after cb completes
      output: '**/*.sra'
    },
    // the cb for this task
    ( ({ input }) => ncbi.download(input.db, input.accession) )
  )(next)
}

function fastqDump(next) {
  return task(
  {
    input: new File('**/*.sra'),
    output: [1, 2].map(n => new File(`*_${n}.fastq.gz`))
  },
  ({ input }) => shell(`fastq-dump --split-files --skip-technical --gzip ${input}`)
)(next)
}

function downloadReference(next) {
  return task(
  {
    input: config.referenceURL,
    output: new File(last(config.referenceURL, '/'))
  },
  ({ input, output }) => request(input).pipe(fs.createWriteStream(output.value))
  )(next)
}

function bwaIndex(next) {
  return task(
  {
    input: new File('*_genomic.fna.gz'),
    output: ['amb', 'ann', 'bwt', 'pac', 'sa'].map(suffix => new File(`*_genomic.fna.gz.${suffix}`))
  },
  ({ input }) => shell(`bwa index ${input}`)
  )(next)
}

function alignAndSort(next) {
  return task(
  {
    input: [new File('*_genomic.fna.gz'), new File('*.fastq.gz')],
    output: new File('reads.bam')
  },
  ({ input }) => shell(`
bwa mem -t ${THREADS} ${input[0]} ${input[1]} ${input[2]} | \
samtools view -Sbh - | \
samtools sort - -o reads.bam `)
  )(next)
}

function samtoolsIndex(next) {
  return task(
  {
    input: new File('*.bam'),
    output: new File('*.bam.bai')
  },
  ({ input }) => shell(`samtools index ${input}`)
  )(next)
}

function decompressReference(next) {
  return task(
  {
    input: new File('*_genomic.fna.gz'),
    output: new File('*_genomic.fna')
  },
  ({ input }) => shell(`bgzip -d ${input}`)
  )(next)
}

function mpileupAndCall(next) {
  return task(
  {
    input: [new File('*_genomic.fna'), new File('*.bam'), new File('*.bam.bai')],
    output: new File('variants.vcf')
  },
  ({ input }) => shell(`
samtools mpileup -uf ${input[0]} ${input[1]} | \
bcftools call -c - > variants.vcf
    `)
  )(next)
}

// function after(next) {
//   return task(
//   {
//     input: null,
//     output: null
//   },
//   () => shell('echo AFTER')
//   )(next)
// }

const pipeline = parallel({
  taskLists: [[samples], [downloadReference, bwaIndex]],
  next: join(alignAndSort, samtoolsIndex, decompressReference, mpileupAndCall)
})
pipeline()
