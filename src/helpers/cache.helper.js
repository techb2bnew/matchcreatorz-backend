'use strict';

/**
 * Simple in-memory TTL cache.
 * Resets on pm2 restart — good enough for dashboard stats.
 */
const store = new Map();

/**
 * Get cached value. Returns undefined if missing or expired.
 */
function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

/**
 * Set a value with TTL in seconds (default 60s).
 */
function set(key, value, ttlSeconds = 60) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Delete a specific key (call on data mutations).
 */
function del(key) {
  store.delete(key);
}

/**
 * Delete all keys matching a prefix.
 */
function delByPrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

module.exports = { get, set, del, delByPrefix };
