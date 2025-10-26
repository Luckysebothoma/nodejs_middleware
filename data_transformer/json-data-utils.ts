// src/app/utils/json-data-utils.ts

export class JsonDataUtils {
  /**
   * Safely parses a JSON string to object/array.
   */
  static safeParse(json: string): any {
    try {
      return JSON.parse(json);
    } catch (e) {
      console.error('❌ JSON parse failed:', e);
      return null;
    }
  }

  /**
   * Parses and flattens a nested array string like '[[{...}, {...}]]'
   */
  static parseAndFlatten(json: string): any[] {
    const parsed = this.safeParse(json);
    return Array.isArray(parsed) ? parsed.flat() : [];
  }

  /**
   * Parses a JSON array string with optional single nesting
   */
  static parseArray(json: string): any[] {
    const parsed = this.safeParse(json);
    if (!Array.isArray(parsed)) return [];
    return Array.isArray(parsed[0]) ? parsed[0] : parsed;
  }

  /**
   * Converts date-like string fields into Date objects
   */
  static convertDates(items: any[], dateKeys: string[]): any[] {
    return items.map(item => {
      const clone = { ...item };
      dateKeys.forEach(key => {
        if (clone[key]) {
          clone[key] = new Date(clone[key]);
        }
      });
      return clone;
    });
  }

  /**
   * Picks specific keys from objects in array
   */
  static selectKeys(items: any[], keys: string[]): any[] {
    return items.map(item =>
      keys.reduce((acc, key) => {
        if (item.hasOwnProperty(key)) {
          acc[key] = item[key];
        }
        return acc;
      }, {} as any)
    );
  }

  /**
   * Coerces values of specific keys to numbers
   */
  static convertToNumbers(items: any[], keys: string[]): any[] {
    return items.map(item => {
      const clone = { ...item };
      keys.forEach(key => {
        if (clone[key] != null && !isNaN(clone[key])) {
          clone[key] = Number(clone[key]);
        }
      });
      return clone;
    });
  }

  /**
   * Filters out falsy values or null/undefined entries from an array
   */
  static filterValid(items: any[]): any[] {
    return items.filter(item => item !== null && item !== undefined && item !== false && item !== '');
  }

  /**
   * Flattens nested arrays deeply
   */
  static deepFlatten(input: any[]): any[] {
    return input.flat(Infinity);
  }

  /**
   * Groups items by a specific key
   */
  static groupBy(items: any[], key: string): Record<string, any[]> {
    return items.reduce((acc, item) => {
      const groupKey = item[key];
      if (!acc[groupKey]) {
        acc[groupKey] = [];
      }
      acc[groupKey].push(item);
      return acc;
    }, {} as Record<string, any[]>);
  }
}
