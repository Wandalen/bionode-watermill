'use strict'

const { task } = require('.')

const intoStream = require('into-stream')
const fs = require('fs')
const myTask = task({
  input: { value: 'foo' },
  output: { file: 'file.txt' },
  name: 'My Task'
}, ({ input }) => intoStream(input).pipe(fs.createWriteStream('file.txt')))

myTask()
  .on('close' , function () {
    console.log('============== GOT CLOSE =======================')
    // creating output on close
    // this.output()

    // using already created output (preferred, but child process throws close itself)
    console.log('output:', this._output)
  })
