// Service to fetch Airtable field metadata
const AIRTABLE_CONFIG = {
  baseId: 'appRiU9sw7RjOdGbk',
  token: 'patiiLJEXjP1oExM6.2b93f838d611daaab7c886ea6ebd86f6264ba697d2520d126ce8d344c9ddb8a6',
  tableId: 'tblYix3jMMM9MhIds'
};

const getAirtableFieldMetadata = async () => {
  try {
    const response = await fetch(`https://api.airtable.com/v0/meta/bases/${AIRTABLE_CONFIG.baseId}/tables`, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_CONFIG.token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch metadata: ${response.status}`);
    }

    const result = await response.json();
    const table = result.tables.find(t => t.id === AIRTABLE_CONFIG.tableId);
    
    if (!table) {
      throw new Error('Table not found');
    }

    console.log('Airtable fields:', table.fields);
    
    return table.fields.map(field => ({
      id: field.id,
      name: field.name,
      type: field.type,
      options: field.options || null,
      description: field.description || null
    }));
  } catch (error) {
    console.error('Error fetching field metadata:', error);
    return [];
  }
};

// Generate options from existing data for fields without predefined choices
// This version takes the FIELD_MAPPING from App.js to work with internal field names
const generateOptionsFromData = (existingData, airtableFieldName, fieldMapping = null) => {
  if (!existingData || existingData.length === 0) return [];
  
  const values = new Set();
  
  // If we have a field mapping, use it to find the internal field name
  let internalFieldName = airtableFieldName;
  if (fieldMapping) {
    // Find the internal field name by looking for the airtable field name in the mapping values
    internalFieldName = Object.keys(fieldMapping).find(key => fieldMapping[key] === airtableFieldName);
  }
  
  if (!internalFieldName) {
    console.warn(`No internal field found for Airtable field: ${airtableFieldName}`);
    return [];
  }
  
  existingData.forEach(item => {
    const fieldValue = item[internalFieldName];
    
    if (Array.isArray(fieldValue)) {
      fieldValue.forEach(val => {
        if (val && typeof val === 'string') {
          val.split(',').forEach(subVal => {
            const cleaned = subVal.trim();
            if (cleaned && cleaned !== '') {
              values.add(cleaned);
            }
          });
        }
      });
    } else if (fieldValue && typeof fieldValue === 'string') {
      fieldValue.split(',').forEach(val => {
        const cleaned = val.trim();
        if (cleaned && cleaned !== '') {
          values.add(cleaned);
        }
      });
    }
  });

  return Array.from(values).sort();
};

// Add data to Airtable - this function now expects Airtable field names directly
const addToAirtable = async (airtableFormData) => {
  console.log('Starting addToAirtable function');
  console.log('Input data with Airtable field names:', airtableFormData);
  
  try {
    // First, get field metadata to validate select field values
    const fieldMetadata = await getAirtableFieldMetadata();
    const fieldMap = new Map(fieldMetadata.map(field => [field.name, field]));
    
    console.log('Building Airtable payload...');
    
    // Helper function to convert single values to arrays (properly handle comma-separated values)
    const toArrayField = (value) => {
      if (!value || value === '') return [];
      if (Array.isArray(value)) return value.filter(v => v && v.trim());
      // Split by comma, trim whitespace, filter out empty strings
      return value.split(',')
        .map(v => v.trim())
        .filter(v => v.length > 0);
    };
    
    // Helper function to validate select field values
    const validateSelectValue = (fieldName, value, fieldType) => {
      const field = fieldMap.get(fieldName);
      if (!field || !field.options || !field.options.choices) {
        console.warn(`No field metadata or choices found for ${fieldName}`);
        return value; // Return as-is if no validation data
      }
      
      const validOptions = field.options.choices.map(choice => choice.name);
      console.log(`Valid options for ${fieldName}:`, validOptions);
      
      if (fieldType === 'singleSelect') {
        if (!validOptions.includes(value)) {
          console.warn(`Invalid single select value "${value}" for field ${fieldName}. Valid options:`, validOptions);
          return null; // Don't send invalid values
        }
        return value;
      } else if (fieldType === 'multipleSelects') {
        const validValues = value.filter(v => validOptions.includes(v));
        const invalidValues = value.filter(v => !validOptions.includes(v));
        if (invalidValues.length > 0) {
          console.warn(`Invalid multiple select values [${invalidValues.join(', ')}] for field ${fieldName}. Valid options:`, validOptions);
        }
        return validValues.length > 0 ? validValues : null;
      }
      
      return value;
    };
    
    const airtableData = {
      fields: {}
    };

    // Process each field from the form data
    Object.entries(airtableFormData).forEach(([fieldName, value]) => {
      if (!value && value !== false && value !== 0) return; // Skip empty values except false and 0
      
      const field = fieldMap.get(fieldName);
      const fieldType = field ? field.type : 'unknown';
      
      console.log(`Processing field ${fieldName} (type: ${fieldType}):`, value);
      
      // Handle different field types
      if (typeof value === 'boolean') {
        airtableData.fields[fieldName] = value;
      } else if (fieldName === 'Year' && value) {
        // Handle year field specifically
        const yearValue = parseInt(value);
        if (!isNaN(yearValue)) {
          airtableData.fields[fieldName] = yearValue;
        }
      } else if (fieldType === 'singleSelect') {
        // Handle single select fields with validation
        const validatedValue = validateSelectValue(fieldName, value.toString().trim(), 'singleSelect');
        if (validatedValue) {
          airtableData.fields[fieldName] = validatedValue;
        }
      } else if (fieldType === 'multipleSelects') {
        // Handle multiple select fields with validation
        const arrayValue = toArrayField(value);
        const validatedValues = validateSelectValue(fieldName, arrayValue, 'multipleSelects');
        if (validatedValues && validatedValues.length > 0) {
          airtableData.fields[fieldName] = validatedValues;
        }
      } else if (typeof value === 'string' && value.includes(',') && fieldType !== 'singleSelect') {
        // Handle comma-separated values as arrays (but not for single select)
        const arrayValue = toArrayField(value);
        if (arrayValue.length > 0) {
          airtableData.fields[fieldName] = arrayValue;
        }
      } else if (value && value.toString().trim()) {
        // Handle single values
        airtableData.fields[fieldName] = value.toString().trim();
      }
    });

    console.log('Final Airtable payload:', JSON.stringify(airtableData, null, 2));
    console.log('Field types from form data:', Object.keys(airtableFormData).map(key => `${key}: ${typeof airtableFormData[key]} = "${airtableFormData[key]}"`));

    const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.tableId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_CONFIG.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(airtableData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Request failed:', errorText);
      return false;
    }

    const result = await response.json();
    console.log('Successfully added record:', result);
    return true;
  } catch (error) {
    console.error('Exception in addToAirtable:', error);
    return false;
  }
};

// Export all functions
export { getAirtableFieldMetadata, generateOptionsFromData, addToAirtable };