'use strict'

// === WATERWHEEL ===
const {
  task,
  join,
  shell
} = require('../..')

// === MODULES ===
const fs = require('fs')

const request = require('request')
const ncbi = require('bionode-ncbi')

// === CONFIG ===
const THREADS = parseInt(process.env.WATERWHEEL_THREADS) || 4
const config = {
  name: 'Salmonella enterica',
  sraAccession: '2492428',
  referenceURL: 'http://ftp.ncbi.nlm.nih.gov/genomes/all/GCA_000988525.2_ASM98852v2/GCA_000988525.2_ASM98852v2_genomic.fna.gz'
}

// === TASKS ===

/**
 * Downloads the reference genome from NCBI.
 * @input {string} the reference url
 * @output {file} the reference genome in fna.gz
 * @action http request | writable
 */
const getReference = task({
  params: { url: config.referenceURL },
  input: null,
  output: '*_genomic.fna.gz',
  name: `Download reference genome for ${config.name}`
}, ({ params }) => {
  const { url } = params
  const outfile = url.split('/').pop()

  // essentially curl -O
  return request(url).pipe(fs.createWriteStream(outfile))
})


/**
 * Indexes a reference genome with bwa.
 * @input {string} the reference genome ending in _genomic.fna.gz
 * @output {file[]} the annotation, index, etc. files produced by "bwa index"
 * @action {shell}
 */
const bwaIndex = task({
  input: '*_genomic.fna.gz',
  output: ['amb', 'ann', 'bwt', 'pac', 'sa'].map(suffix => `*_genomic.fna.gz.${suffix}`),
  name: 'bwa index *_genomic.fna.gz',
}, ({ input }) => shell(`bwa index ${input}`) )


// join(getReference, bwaIndex)()
//   .on('destroy', function() {
//     console.log('output: ', JSON.stringify(this._output, null, 2))
//   })


/**
 * Downloads the reads samples in SRA format.
 * @input.db {string} the NCBI database
 * @input.accession {string} the accession ID
 * @output {file} the reads
 * @action {readable} the stream returned by ncbi.download
 */
const getSamples = task({
  params: {
    db: 'sra',
    accession: config.sraAccession
  },
  input: null,
  output: '**/*.sra',
  name: `Download SRA ${config.sraAccession}`
}, ({ params }) => ncbi.download(params.db, params.accession) )

getSamples()
  .on('destroy', function() {
    console.log('output: ', JSON.stringify(this._output, null, 2))
  })

/**
 * Extracts SRA into fastq using fastq-dump.
 * @input {file} the reads
 * @output {file[]} the written ends
 * @action {shell}
 */
const fastqDump = task({
  input: { file: '**/*.sra' },
  output: [1, 2].map(n => ({ file: `*_${n}.fastq.gz` })),
  name: 'fastq-dump **/*.sra'
}, ({ input }) => shell(`fastq-dump --split-files --skip-technical --gzip ${input}`) )


/**
 * Align reads and sort.
 * @input.reference {file} reference genome
 * @input.reads.1 {file} reads end 1
 * @input.reads.2 {file} reads end 2
 * @output {file} bam
 * @action {shell}
 */
const alignAndSort = task({
  input: {
    reference: { file: '*_genomic.fna.gz' },
    reads: {
      1: { file: '*_1.fastq.gz' },
      2: { file: '*_2.fastq.gz' }
    }
  },
  output: [{ file: 'reads.bam' }, { file: '*_genomic.fna' }], // NOTE forced genomic.fna into here
  name: 'bwa mem | samtools view | samtools sort',
  skipPassed: true
}, ({ input }) => shell(`
bwa mem -t ${THREADS} ${input.reference} ${input.reads['1']} ${input.reads['2']} | \
samtools view -@ ${THREADS} -Sbh - | \
samtools sort -@ ${THREADS} - -o reads.bam > reads.bam
`))


/**
 * Index bam.
 * @input {file} the bam
 * @output {file} the binary alignment index
 * @action {shell}
 */
const samtoolsIndex = task({
  input: { file: 'reads.bam' },
  output: { file: '*.bam.bai' },
  name: 'samtools index'
}, ({ input }) => shell(`samtools index ${input}`))


/**
 * Decompress a reference genome.
 * @input {file} the reference genome
 * @output {file} the decompressed reference genome
 * @action {shell}
 */
const decompressReference = task({
  input: { file: '*_genomic.fna.gz' },
  output: { file: '*_genomic.fna' },
  name: 'Decompress reference'
}, ({ input }) => shell(`bgzip -d ${input} --stdout > ${input.slice(0, -('.gz'.length))}`) )


/**
 * Multipileup bam and call variants.
 * @input.reference {file} the reference genome
 * @input.bam {file} the binary alignment map
 * @input._bai {file} the binary alignment index, not used directly but required
 * @output {file} variant calling format
 * @action {shell}
 */
const mpileupandcall = task({
  input: {
    reference: { file: '*_genomic.fna' },
    bam: { file: '*.bam' },
    _bai: { file: '*.bam.bai' }
  },
  output: { file: 'variants.vcf' },
  name: 'samtools mpileup | bcftools call',
  // skipPassed: true
}, ({ input }) => shell(`
samtools mpileup -uf ${input[1]} ${input[0]} | \
bcftools call -c - > variants.vcf
`))
// NOTE the input[0] and input[1] is highly hardcoded and sketchy and based on
// console.log output

// === task orchestration ===

// const reads = join(getSamples, fastqDump)
// const reference = join(getReference, parallel(bwaIndex, decompressReference))
// const call = join(alignAndSort, samtoolsIndex, mpileupandcall)
//
// const pipeline = join(parallel(reads, reference), call)
//
// call()
//   .on('close', function() {
//     this.output()
//     console.log('Pipeline has finished')
//   })
