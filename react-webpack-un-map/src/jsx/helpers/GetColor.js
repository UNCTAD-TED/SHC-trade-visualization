// Define a color mapping function based on value (special cases dealt with by getColor)
function getColorFromValue(value, type) {
  // Return grey if value is null, NaN, or undefined
  if (value === null || value === undefined || Number.isNaN(value) || !type) {
    return '#DED9D5';
  }
  return '#DED9D5';
}

// Define a color mapping function based on value **and code**
const getColor = (value, code, data, type, china_areas) => {
  // First check if this code is special
  if (code === 'C00002') { // AksaiChin
    const kashmirData = data.find(item => item.code === 'C00007'); // Find kashmir in data
    const kashmirValue = kashmirData ? kashmirData[type] : null; // Get kashmir's value, default to null
    const chinaData = data.find(item => item.code === '156'); // Find china in data
    const chinaValue = chinaData ? chinaData[type] : null; // Get china's value, default to null
    return {
      pattern: {
        backgroundColor: getColorFromValue(kashmirValue, type),
        color: getColorFromValue(chinaValue, type),
        height: 10 / 100000, // Height of the pattern
        path: {
          d: 'M 0 10 L 10 0 M -1 1 L 1 -1 M 9 11 L 11 9',
          strokeWidth: 2.5 * Math.sqrt(2),
        },
        width: 10 // Width of the pattern
      }
    };
  }
  if (code === 'C00003') { // ArunachalPradesh = India
    const indiaData = data.find(item => item.code === '356');
    const indiaValue = indiaData ? indiaData[type] : null;
    return getColorFromValue(indiaValue, type);
  }
  if (code === '412') { // Kosovo = Serbia
    const serbiaData = data.find(item => item.code === '688');
    const serbiaValue = serbiaData ? serbiaData[type] : null;
    return getColorFromValue(serbiaValue, type);
  }
  if (china_areas.includes(code)) { // Macao, HongKong, China, Taiwan = China
    const chinaData = data.find(item => item.code === '156');
    const chinaValue = chinaData ? chinaData[type] : null;
    return getColorFromValue(chinaValue, type);
  }

  return getColorFromValue(value, type);
};

export default getColor;
