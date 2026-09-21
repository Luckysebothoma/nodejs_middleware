import { formatForMySQL } from '../utils/formatForMySQL.js';
const cacheKey = 'availableItems'; // Key to store the list in Redis
let keyExist = false;
import TimeUtils from '../utils/Time.js';
import ControllerHandler from "../utils/ControllerHandler.js";
 
import { getConnection } from '../config/db.js';


const { formattedDate, getShortTime, getMidTime } = TimeUtils;
const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;
import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';


// we need to see what values are being passed in the request body and log them for debugging purposes

export const addDailyOps = async (req, res) => {
    try {
        await logRequestDetails(req, 'addDailyOps');
    }catch (error) {
        console.error('Error in addDailyOps:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }        
}