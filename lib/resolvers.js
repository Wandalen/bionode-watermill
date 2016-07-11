'use strict'

// pattern matching
const globby = require('globby')
const multimatch = require('multimatch')
const chalk = require('chalk')
const fs = require('fs')
const checksum = require('checksum')

const validators = require('./validators.js')
const { tab } = require('./utils.js')
const traverser = require('./traverser.js')

/**
 * key = value
 * obj = { value: 'foo' }
 * @returns 'foo'
 */
const valueResolver = (key, obj, mode) => {
  const val = obj[key]

  console.log(tab(2) + 'resolved ' + chalk.magenta(val) + (mode === 'passed' ? ' from passed in ' : ' from ') + chalk.cyan('value'))
  return val
}

const defaultFileValidators = [
  validators.existenceCheck,
  validators.nullCheck
]

const fileResolver = (key, obj, mode, input, customValidators) => {
  const val = obj[key]

  if (mode === 'passed') {
    // Compare to task input
    // Can also check obj.resolved here
    // TODO handle better input object
    
    let patterns = []
    // TODO properly traverse
    const addToPatterns = (obj) => {
      if (obj.file) {
        patterns.push(obj.file)
      } else if (Array.isArray(obj)) {
        for (let item of obj) {
          addToPatterns(obj)
        }
      } else if (typeof(obj) === 'object') {
        for (let key in obj) {
          addToPatterns[obj[key]]
        }
      }
    }
    addToPatterns(input)

    console.log('patterns:')
    console.log(patterns)
  

    // Case 1: input is { file: foo }
    // if (input.file) {
    //   patterns = [input.file]
    //
    // // Case 2: input is [{ file: foo }, { file: bar }] 
    // } else if (Array.isArray(input)) {
    //   patterns = input.map(item => item.file)
    //
    // // Case 3: assume { a: { file: foo }, b: { file: foo } }
    // } else {
    //   for (let key in input) {
    //     patterns.push(input[key].file)
    //   }
    // }

    let matches = multimatch(val, patterns) 

    console.log('val, matches')
    console.log(val, matches)

    // Just check if patterns match. Validation occurred after end of last task.

    if (matches.length === 1) {
      console.log(tab(2) + 'input: ' + chalk.magenta(val) + ' from passed in ' + chalk.cyan('file'))
      obj = val[0]
    }
  } else if (mode === 'start') {
    defaultFileValidators.forEach((validator) => {
      const result = validator(obj)

      if (!result) {
        console.log(tab(2) + chalk.red('An input validation failed'))
        return obj
      }
    })

    // If we got here, no validators returned false

    console.log(tab(2) + 'input: ' + chalk.magenta(obj.file[0]) + ' from ' + chalk.cyan('file'))
    obj = obj.file[0]
  } else if (mode === 'end' || mode === 'checking') {
    console.log(tab(2) + chalk.yellow('Running validations') + ' for ' + val)
    defaultFileValidators.forEach((validator) => {
      const result = validator(obj)

      if (!result) {
        console.log(tab(2) + chalk.red('An input validation failed'))
        return obj
      }
    })
    if (customValidators) {
      for (let validator of customValidators) {
        const result = validator(obj)

        if (!result) {
          console.log(tab(2) + chalk.red('An input validation failed'))
          // TODO another way to do this?
          obj.resolved = false
          return obj
        }  
      }
    }

    console.log(tab(3) + 'passed validators')
    // TODO check for resolved:true
  }

  return obj
}

const checksummer = (resolved) => {
  if (!(resolved instanceof Array)) {
    resolved = [resolved] 
  }

  console.log(tab(1) + 'Now going to generate checksums on resolved files')

  for (let obj of resolved) {
    if (obj.file) {
      for (let filePath of obj.file) {
        // TODO handle errors better
        checksum.file(filePath, (err, sum) => {
          if (err) {
            console.error(err)
            return 
          }
          const stats = fs.statSync(filePath)

          // console.log(tab(2) + filePath + ' -> ' + sum + ', ' + stats.mtime)
  
          const objDetails = {}

          objDetails[filePath] = {
            hash: sum,
            time: stats.mtime.getTime()
          }

          if (validators.existenceCheck({ file: 'waterwheel.json' })) {
            let currentObj = JSON.parse(fs.readFileSync('waterwheel.json', 'utf-8'))
            fs.writeFileSync('waterwheel.json', JSON.stringify(Object.assign(currentObj, objDetails), null, 2))
          } else {
            fs.writeFileSync('waterwheel.json', JSON.stringify(objDetails, null, 2))
          }
        })
      }
    }
  }

  console.log(tab(1) + 'Wrote hash+time info to waterwheel.json')
}

const outerResolver = (obj, props, mode, extraResolvers) => {
  if (!extraResolvers) {
    extraResolvers = {}
  }

  const resolved = traverser(obj, (key, obj) => {
    const val = obj[key]

    switch(key) {
      case 'value':
        obj = valueResolver(key, obj, mode)
        break
      case 'file':
        obj = fileResolver(key, obj, mode, props.input, extraResolvers.fileResolvers)
        break
      case 'resolved':
        break
      default:
        console.log(key, val)
        return false
    }

    return obj
  })

  if (mode === 'end') {
    checksummer(resolved)
  }

  return resolved
}

module.exports = outerResolver
