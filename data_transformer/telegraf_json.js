




export const buildTelegrafPayload = ({ measurement, tags, fields, timestamp = Date.now() * 1e6 }) => {
  if (!measurement || typeof fields !== 'object') {
    throw new Error('Missing required fields: measurement or fields');
  }

  return {
    measurement,
    tags: tags || {},
    fields,
    timestamp,
  };
};
