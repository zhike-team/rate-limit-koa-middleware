'use strict';

module.exports = (options) => {
  if (!(options instanceof Object)) {
    throw new Error('options must be an Object');
  }

  const redis = options.redisClient;
  if (typeof redis !== 'object') {
    throw new Error('options.redisClient must be an instance of redis(https://www.npmjs.com/package/redis) or ioredis(https://www.npmjs.com/package/ioredis)');
  }

  const windowMs = options.windowMs;
  if (!(Number.isInteger(windowMs) && windowMs > 0)) {
    throw new Error('options.windowMs must be an integer larger than zero');
  }

  const max = options.max;
  if (!(Number.isInteger(max) && max > 0)) {
    throw new Error('options.max must be an integer larger than zero');
  }

  let keyFn = ctx => {
    // default key is IP address
    let ip = ctx.ip;
    return 'rate-limit-middleware:' + ip;
  }
  if (options.keyGenerator) {
    if (typeof options.keyGenerator === 'function') {
      keyFn = options.keyGenerator;
    }
    else {
      throw new Error('options.keyGenerator must be a function which returns a string as redis key');
    }
  }

  let onLimitReached = async (ctx, next, redisKey, redisValue) => {
    // default behavior when reach limit
    let err = new Error('Too many requests');
    err.status = 429;
    throw err;
  }
  if (options.onLimitReached) {
    if (typeof options.onLimitReached === 'function') {
      onLimitReached = options.onLimitReached;
    }
    else {
      throw new Error('options.onLimitReached must be a function which handles response when rate limit is reached');
    }
  }

  let onError = async (err, ctx, next) => {
    // default behavior: throw exception
    throw err;
  }
  if (options.onError) {
    if (typeof options.onError === 'function') {
      onError = options.onError;
    }
    else {
      throw new Error('options.onError must be a function which handles response when cannot access redis');
    }
  }

  let skip = ctx => Promise.resolve(false); // not skip by default
  if (options.skip) {
    if (typeof options.skip === 'function') {
      skip = options.skip;
    }
    else {
      throw new Error('options.skip must be a function which return a Promise');
    }
  }

  const getCurrentCount = async redisKey => {
    const lua = `
          local current
          current = tonumber(redis.call("incr", KEYS[1]))
          if current == 1 then
            redis.call("pexpire", KEYS[1], ARGV[1])
          end
          return current`;

    return new Promise((resolve, reject) => {
      function errorHandler(err) {
        reject(err);
      }

      redis.once('error', errorHandler);

      redis.eval(lua, 1, redisKey, windowMs, (err, result) => {
        redis.removeListener('error', errorHandler);
        if (err) {
          reject(err);
        }
        else {
          resolve(result);
        }
      });
    });

  }

  return async (ctx, next) => {
    let shouldSkip = await skip(ctx);
    if (shouldSkip) {
      return next();
    }

    let redisKey = keyFn(ctx);
    let count
    try {
      count = await getCurrentCount(redisKey);
    }
    catch (e) {
      return await onError(e, ctx, next);
    }

    if (count > max) {
      await onLimitReached(ctx, next, redisKey, count);
    }
    else {
      return next();
    }
  }
}
