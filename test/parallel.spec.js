'use strict'

const { assert } = require('chai')

const task = require('../lib/Task.js')
const parallel = require('../lib/parallel.js')


const delayedResolve = (str, time) => task({
  name: `Return ${str} after ${time}ms`
}, () => new Promise((resolve, reject) => {
  setTimeout(() => resolve(str), time)
}))

describe('Parallel', function() {
  it.skip('should run two tasks in parallel', function(done) {
    const task1 = delayedResolve('foo', 1000)
    const task2 = delayedResolve('bar', 500)

    parallel(task1, task2)()
      .on('close', function() {
        const data = this.output()

        assert(data[0].toString() === 'bar')
        assert(data[1].toString() === 'foo')

        done()
      })
  })

  it.skip('should parallel parallel', function(done) {
    const taskA1 = delayedResolve('A1', 100)
    const taskA2 = delayedResolve('A2', 500)
    const taskB1 = delayedResolve('B1', 200)
    const taskB2 = delayedResolve('B2', 400)

    const p1 = parallel(taskA1, taskA2)
    const p2 = parallel(taskB1, taskB2)

    parallel(p1, p2)()
      .on('close', function() {
        const data = this.output()

        assert(data[0][0].toString() === 'B1')
        assert(data[0][1].toString() === 'B2')
        assert(data[1][0].toString() === 'A1')
        assert(data[1][1].toString() === 'A2')

        done()
      })
  })

  it.skip('should arrive in proper order', function(done) {
    const taskA1 = delayedResolve('A1', 100)
    const taskA2 = delayedResolve('A2', 500)
    const taskB1 = delayedResolve('B1', 200)
    const taskB2 = delayedResolve('B2', 400)

    parallel(taskA1, taskA2, taskB1, taskB2)()
      .on('close', function() {
        const data = this.output()

        assert(data[0].toString() === 'A1')
        assert(data[1].toString() === 'B1')
        assert(data[2].toString() === 'B2')
        assert(data[3].toString() === 'A2')

        done()
      })
  })
})
