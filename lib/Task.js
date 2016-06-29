'use strict'

const stream = require('readable-stream')
const isStream = require('isstream')
const chalk = require('chalk')
const globby = require('globby')
const co = require('co')

const { tab } = require('./utils.js')
const { File } = require('./types.js')

class Duplex extends stream.Duplex {
  constructor(opts) {
    super(opts)
  }

  _read(size) {
    console.log('reading')
  }

  _write(chunk, encoding, callback) {
    console.log('writing: ' + chunk.toString())

    this.push(chunk)
    callback()
  }
}

// Would use https://www.npmjs.com/package/stream-from-promise but may
// need to handle special resolve values (e.g. promise resolves to a stream) later
class ReadableFromPromise extends stream.Readable {
  constructor(promise, opts) {
    super(opts)

    this._promise = promise
  }

  _read(size) {
    this._promise
      .then((data) => {
        this.push(data)
        this.push(null)
      })
      .catch((err) => {
        this.emit('error', err)
        this.push(null)
      })
  }
}

class ReadableFromCallback extends stream.Readable {
  constructor(action, opts) {
    super(opts)

    this._action = action
  }

  _read(size) {
    this._action((err, data) => {
      if (err !== null) {
        this.emit('error', err)
        this.push(null)
      } else {
        this.push(data)
        this.push(null)
      }
    })
  }
}

/**
 * The Task class.
 * @param  {Object} props         object with input and output
 * @param  {function} actionCreator function to produce an actionCreator
 * @return {stream}               stream to be orchestrated
 */
const task = (props, actionCreator) => co.wrap(function * () {
  // TODO check if actionCreator is a function
  if (props === null) {
    console.log('Got null props')
    props = {
      input: null,
      name: 'noname'
    }
  }


  // TODO handle unnamed task
  const { input, name } = props
  let resolvedInput = input
  // TODO task lifecycle
  // 1. preparing
  console.log(`Running task ${chalk.blue(name)}`)
  // 2. resolving input
  // TODO
  // 2. use values passed in from last Task
  console.log(tab(1) + 'Resolving input')
  // 1. resolve props OR 
  if (input instanceof File) {
    try {
      const globbyData = yield globby(input.value)
      resolvedInput = { input: globbyData[0] } 
    } catch(e) {
      console.error(e)
    }
    console.log(tab(2) + 'input: ' + resolvedInput.input + ' from ' + input.value)
  }
  // 3. creating
  // TODO use input/output, resolved promise, callback to determine stream type.
  // Or just always be duplex.
  let stream
  // const stream = new Readable()

  // Create the action
  // TODO handle actual callbacks, in which case we cant call this yet 
  const resolvedProps = Object.assign(props, resolvedInput)
  console.log(resolvedProps)
  const action = actionCreator(resolvedProps)

  // Get its type: can be stream, promise, function
  const actionType = (() => {
    if (action instanceof Promise) {
      return 'promise'
    } else if (typeof(action) === 'function') {
      // assume action returns function of signature fn(err, data)
      return 'curried-callback'
    } else if (isStream(action)) {
      return 'stream'
    } else {
      return 'unkown'
    }
  })()

  switch(actionType) {
    case 'promise':
      stream = new ReadableFromPromise(action)
      console.log(tab(1) + 'Creating a Readable from promise')
      break
    case 'curried-callback':
      stream = new ReadableFromCallback(action)
      break
    case 'stream':
      stream = action
      console.log(tab(1) + 'Creating a stream from stream')
      break
    default:
      console.log('Bad action type')
  }

  // 4. running
  // 5. resolving output
  // 6. ending, passing on output
  
  // console.log(stream)

  return stream
})

module.exports = task
