import { logResponseDetails } from '../utils/requestLogger.js';

// Fields the frontend sends for a daily operation.
const REQUIRED = ['date', 'productId', 'productQuantity', 'costPerItem', 'sellingPrice', 'productProfit', 'productCommission'];
const isMissing = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// NOTE: this handler used to log the body and then return WITHOUT ever sending a response (and without saving
// anything), so every request hung until the browser timed out. It now always answers.
// It still does NOT persist: there is no dailyOps table, and the totals the frontend sends are currently wrong
// (productCommission = profit-per-item x quantity^2; productProfit is revenue for some products), so they must
// not be written into daily_financials as-is. Decide the destination table, then replace the 501 below with an upsert.
export const addDailyOps = async (req, res) => {
  try {
    console.log('Request Body addDailyOps:', req.body);

    const body = req.body ?? {};
    const missing = REQUIRED.filter((k) => isMissing(body[k]));
    if (missing.length) {
      return logResponseDetails(req, res, {
        status: 400,
        success: false,
        message: 'Please provide all fields',
        response: `Missing: ${missing.join(', ')}`,
      }, 'dailyOps', 400);
    }

    return logResponseDetails(req, res, {
      status: 501,
      success: false,
      persisted: false,
      message: 'addDailyOps is not implemented yet: nothing was saved',
    }, 'dailyOps', 501);
  } catch (error) {
    console.error('Error in addDailyOps:', error);
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: 'Internal Server Error',
      error: error?.message || String(error),
    }, 'dailyOps', 500);
  }
};
