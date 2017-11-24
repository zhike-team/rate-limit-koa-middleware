const getRateLimit = require('../index')
const Promise = require('bluebird')
const Redis = require('ioredis')
const redis = new Redis()
const assert = require('assert')
const supertest = require('supertest')
const Koa = require('koa')
const Router = require('koa-router')
const router = new Router()

const redisKey = 'test:someKey'

const app = new Koa()
app.proxy = true
app.use(router.routes())

function request() {
  return supertest(app.listen());
}

const windowMs = 1000

const rateLimit1 = getRateLimit({
  redisClient: redis,
  keyGenerator: ctx => redisKey,
  windowMs: 1000,
  max: 1
})

router.get('/', rateLimit1, function (ctx, next) {
  ctx.body = ''
})

function clearRedis(done) {
  redis.del(redisKey, err => {
    if (err) {
      throw err
    }
    done()
  })
}

describe('Basic block', function () {
  // before('clear redis', clearRedis)

  it('1st request pass through', function (done) {
    request()
      .get('/')
      .expect(200, done)
  })

  it('2nd request blocked', function (done) {
    request()
      .get('/')
      .expect(429, done)
  })
})

describe('Wait expire', function () {
  before('clear redis', clearRedis)

  it('1st request pass through', function (done) {
    request()
      .get('/')
      .expect(200, done)
  })

  it('2nd request blocked', function (done) {
    request()
      .get('/')
      .expect(429, done)
  })

  it('3rd request pass after expiration', function (done) {
    setTimeout(() => {
      request()
        .get('/')
        .expect(200, done)
    }, windowMs)
  })
})

const rateLimit2 = getRateLimit({
  redisClient: redis,
  keyGenerator: req => redisKey,
  onLimitReached: async (ctx, next, redisKey, redisValue) => {
    assert(redisKey === 'test:someKey')
    assert(redisValue === 2)
    ctx.status = 401
    ctx.body = {code: 1}
  },
  skip: ctx => {
    if(ctx.query.skip){
      return Promise.resolve(true)
    }
    else{
      return Promise.resolve(false)
    }
  },
  windowMs: 1000,
  max: 1
})

router.get('/2', rateLimit2, function (ctx) {
  ctx.body = ''
})

describe('Custom response on limit', function () {
  before('clear redis', clearRedis)

  it('1st request pass through', function (done) {
    request()
      .get('/2')
      .expect(200, done)
  })

  it('2nd request blocked and get custom response', function (done) {
    request()
      .get('/2')
      .expect(401, {code: 1}, done)
  })

  it('3rd request should skip', function (done) {
    request()
      .get('/2?skip=true')
      .expect(200, done)
  })
})

const rateLimit3 = getRateLimit({
  redisClient: redis,
  keyGenerator: req => redisKey,
  windowMs: 100,
  max: 2
})

router.get('/3', rateLimit3, function (ctx) {
  ctx.body = ''
})

describe('Allow 2 request in 100ms', function () {
  before('clear redis', clearRedis)

  it('1st request pass through', function (done) {
    request()
      .get('/3')
      .expect(200, done)
  })

  it('2nd request pass through', function (done) {
    request()
      .get('/3')
      .expect(200, done)
  })

  it('3rd request blocked', function (done) {
    request()
      .get('/3')
      .expect(429, done)
  })

  it('4th request pass after expiration', function (done) {
    setTimeout(() => {
      request()
        .get('/3')
        .expect(200, done)
    }, 100)
  })
})

const errorRedis = new Redis({port: 9999})

const rateLimit4 = getRateLimit({
  redisClient: errorRedis,
  keyGenerator: ctx => redisKey,
  windowMs: 1000,
  max: 1,
  onError: async (err, ctx, next) => {
    console.log('Redis error and let it go')
    await next()
  }
})

router.get('/4', rateLimit4, function (ctx, next) {
  ctx.body = ''
})

describe('When redis in error', function () {
  it('1st request ignore redis error', function (done) {
    request()
      .get('/4')
      .expect(200, done)
  })
})