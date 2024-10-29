import BN from 'bn.js';

/**
 * Recursively traverses an object and converts all BN instances to strings.
 * @param obj - The object to format.
 * @returns A new object with all BN instances converted to strings.
 */
export function formatBN(obj: any): any {
  if (BN.isBN(obj)) {
    return obj.toString();
  } else if (Array.isArray(obj)) {
    return obj.map(item => formatBN(item));
  } else if (typeof obj === 'object' && obj !== null) {
    const formattedObj: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        formattedObj[key] = formatBN(obj[key]);
      }
    }
    return formattedObj;
  } else {
    return obj;
  }
}
