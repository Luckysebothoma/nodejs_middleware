const api = require('./client');

async function getCacheKey(key) {
  try {
    const res = await api.get(`/cache/${key}`);
    return res.data;
  } catch (error) {
    console.error('❌ Error getting cache:', error.message);
    return null;
  }
}

async function setCacheKey(key, value, ttl = null) {
  try {
    const payload = { value, ttl };
    const res = await api.post(`/cache/${key}`, payload);
    return res.data;
  } catch (error) {
    console.error('❌ Error setting cache:', error.message);
    return null;
  }
}

async function deleteCacheKey(key) {
  try {
    const res = await api.delete(`/cache/${key}`);
    return res.data;
  } catch (error) {
    console.error('❌ Error deleting cache:', error.message);
    return null;
  }
}

module.exports = {
  getCacheKey,
  setCacheKey,
  deleteCacheKey,
};
