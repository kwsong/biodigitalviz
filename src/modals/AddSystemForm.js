import React, { useState, useEffect } from 'react';
import { getAirtableFieldMetadata, generateOptionsFromData } from '../airtableMetadata';
import '../styles/Modal.css';

const AddSystemForm = ({ existingData, onSubmit, onClose }) => {
  const [fields, setFields] = useState([]);
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeDropdown, setActiveDropdown] = useState(null);
  const [searchTerms, setSearchTerms] = useState({});

  useEffect(() => {
    const loadFields = async () => {
      const fieldMetadata = await getAirtableFieldMetadata();
      
      // Process fields and add options
      const processedFields = fieldMetadata.map(field => {
        let options = [];
        
        if (field.type === 'singleSelect' && field.options?.choices) {
          options = field.options.choices.map(choice => choice.name);
        } else if (field.type === 'multipleSelects' && field.options?.choices) {
          options = field.options.choices.map(choice => choice.name);
        } else if (['singleLineText', 'multilineText'].includes(field.type)) {
          // Generate options from existing data for text fields
          options = generateOptionsFromData(existingData, field.name);
        }
        
        return {
          ...field,
          options
        };
      });
      
      setFields(processedFields);
      setLoading(false);
    };
    
    loadFields();
  }, [existingData]);

  const handleFieldChange = (fieldName, value) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  const handleSearchChange = (fieldName, value) => {
    setSearchTerms(prev => ({
      ...prev,
      [fieldName]: value
    }));
    handleFieldChange(fieldName, value);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    console.log('Submitting form data with Airtable field names:', formData);
    
    // Submit the form data directly with Airtable field names
    onSubmit(formData);
  };

  const getFilteredOptions = (field) => {
    const searchTerm = searchTerms[field.name] || '';
    
    if (field.type === 'multipleSelects') {
      // For multi-select, get the last part after the last comma for filtering
      const parts = searchTerm.split(',');
      const lastPart = parts[parts.length - 1].trim();
      
      // Get already selected values
      const selectedValues = parts.slice(0, -1).map(v => v.trim()).filter(Boolean);
      
      // Filter out already selected options and filter by the current search term
      return field.options.filter(option => 
        !selectedValues.includes(option) && 
        option.toLowerCase().includes(lastPart.toLowerCase())
      );
    } else {
      // For single select, normal filtering
      if (!searchTerm) return field.options;
      return field.options.filter(option => 
        option.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
  };

  const handleOptionSelect = (fieldName, option, fieldType) => {
    if (fieldType === 'multipleSelects') {
      // For multi-select, append with comma and continue editing
      const currentValue = formData[fieldName] || '';
      const parts = currentValue.split(',').map(v => v.trim()).filter(Boolean);
      
      // Add the new option if not already selected
      if (!parts.includes(option)) {
        parts.push(option);
      }
      
      const newValue = parts.join(', ');
      handleFieldChange(fieldName, newValue);
      setSearchTerms(prev => ({ ...prev, [fieldName]: newValue + ', ' }));
      // Keep dropdown open for multi-select
      setTimeout(() => setActiveDropdown(fieldName), 10);
    } else {
      // For single select, replace and close
      handleFieldChange(fieldName, option);
      setSearchTerms(prev => ({ ...prev, [fieldName]: option }));
      setActiveDropdown(null);
    }
  };

  const removeChip = (fieldName, chipToRemove) => {
    const currentValue = formData[fieldName] || '';
    const parts = currentValue.split(',').map(v => v.trim()).filter(Boolean);
    const newParts = parts.filter(part => part !== chipToRemove);
    const newValue = newParts.join(', ');
    
    handleFieldChange(fieldName, newValue);
    setSearchTerms(prev => ({ ...prev, [fieldName]: newValue }));
  };

  const getSelectedChips = (fieldName) => {
    const value = formData[fieldName] || '';
    return value.split(',').map(v => v.trim()).filter(Boolean);
  };

  const handleInputBlur = (fieldName) => {
    // Delay closing to allow click events on dropdown options
    setTimeout(() => {
      setActiveDropdown(prev => prev === fieldName ? null : prev);
    }, 200);
  };

  const renderField = (field) => {
    const value = formData[field.name] || '';
    const searchTerm = searchTerms[field.name] || value;
    const filteredOptions = getFilteredOptions(field);
    const showDropdown = activeDropdown === field.name && filteredOptions.length > 0;
    
    // Check if this is a strict select field (predefined options only)
    const isStrictSelect = (field.type === 'singleSelect' || field.type === 'multipleSelects') && 
                          field.options && field.options.length > 0;
    
    switch (field.type) {
      case 'singleLineText':
      case 'multilineText':
        if (field.options.length > 0) {
          // Text field with suggestions (allows custom values)
          return (
            <div style={{ position: 'relative' }}>
              <input 
                type="text"
                className="form-input"
                value={searchTerm}
                onChange={(e) => handleSearchChange(field.name, e.target.value)}
                onFocus={() => setActiveDropdown(field.name)}
                onBlur={() => handleInputBlur(field.name)}
                placeholder={`Type ${field.name}...`}
              />
              {showDropdown && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  backgroundColor: 'white',
                  border: '1px solid #d1d5db',
                  borderTop: 'none',
                  maxHeight: '200px',
                  overflowY: 'auto',
                  zIndex: 1000,
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}>
                  {filteredOptions.map(option => (
                    <div
                      key={option}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        borderBottom: '1px solid #f3f4f6'
                      }}
                      onMouseDown={() => handleOptionSelect(field.name, option, field.type)}
                      onMouseEnter={(e) => e.target.style.backgroundColor = '#f9fafb'}
                      onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                    >
                      {option}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        } else {
          return (
            <input 
              type="text"
              className="form-input"
              value={value}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              placeholder={`Enter ${field.name}`}
            />
          );
        }

      case 'number':
        return (
          <input 
            type="number"
            className="form-input"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={`Enter ${field.name}`}
          />
        );

      case 'checkbox':
        return (
          <label className="form-label">
            <input 
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => handleFieldChange(field.name, e.target.checked)}
            />
            {field.name}
          </label>
        );

      case 'singleSelect':
        if (isStrictSelect) {
          // Pure dropdown for strict select fields
          return (
            <div style={{ position: 'relative' }}>
              <select 
                className="form-input"
                value={value}
                onChange={(e) => handleFieldChange(field.name, e.target.value)}
              >
                <option value="">Select {field.name}...</option>
                {field.options.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
          );
        } else {
          // Searchable dropdown for flexible fields
          return (
            <div style={{ position: 'relative' }}>
              <input 
                type="text"
                className="form-input"
                value={searchTerm}
                onChange={(e) => handleSearchChange(field.name, e.target.value)}
                onFocus={() => setActiveDropdown(field.name)}
                onBlur={() => handleInputBlur(field.name)}
                placeholder={`Select ${field.name}...`}
              />
              {showDropdown && (
                <div className="dropdown-options">
                  {filteredOptions.map(option => (
                    <div
                      key={option}
                      className="dropdown-option"
                      onMouseDown={() => handleOptionSelect(field.name, option, field.type)}
                    >
                      {option}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        }

      case 'multipleSelects':
        const selectedChips = getSelectedChips(field.name);
        
        if (isStrictSelect) {
          // Pure chip selector for strict multiselect fields
          const availableOptions = field.options.filter(option => !selectedChips.includes(option));
          
          return (
            <div className="dropdown-container">
              {/* Display selected chips */}
              {selectedChips.length > 0 && (
                <div className="chips-container">
                  {selectedChips.map(chip => (
                    <div key={chip} className="chip">
                      <span>{chip}</span>
                      <button
                        type="button"
                        className="chip-remove"
                        onClick={() => removeChip(field.name, chip)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              {availableOptions.length > 0 && (
                <select 
                  className="form-input"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      const currentChips = getSelectedChips(field.name);
                      const newChips = [...currentChips, e.target.value];
                      handleFieldChange(field.name, newChips.join(', '));
                      // Reset the select
                      e.target.value = "";
                    }
                  }}
                >
                  <option value="">Add {field.name}...</option>
                  {availableOptions.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              )}
              
              {availableOptions.length === 0 && selectedChips.length > 0 && (
                <div style={{ color: '#666', fontSize: '0.9em', padding: '8px' }}>
                  All options selected
                </div>
              )}
            </div>
          );
        } else {
          // Searchable multiselect for flexible fields
          return (
            <div className="dropdown-container">
              {/* Display selected chips */}
              {selectedChips.length > 0 && (
                <div className="chips-container">
                  {selectedChips.map(chip => (
                    <div key={chip} className="chip">
                      <span>{chip}</span>
                      <button
                        type="button"
                        className="chip-remove"
                        onClick={() => removeChip(field.name, chip)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <input 
                type="text"
                className="form-input"
                value={searchTerm}
                onChange={(e) => handleSearchChange(field.name, e.target.value)}
                onFocus={() => setActiveDropdown(field.name)}
                onBlur={() => handleInputBlur(field.name)}
                placeholder={selectedChips.length > 0 ? `Add another ${field.name}...` : `Type to search ${field.name}...`}
              />
              {showDropdown && (
                <div className="dropdown-options">
                  {filteredOptions.map(option => (
                    <div
                      key={option}
                      className="dropdown-option"
                      onMouseDown={() => handleOptionSelect(field.name, option, field.type)}
                    >
                      {option}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        }

      case 'url':
        return (
          <input 
            type="url"
            className="form-input"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder="https://example.com"
          />
        );

      case 'date':
        return (
          <input 
            type="date"
            className="form-input"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
          />
        );

      default:
        return (
          <input 
            type="text"
            className="form-input"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={`Enter ${field.name}`}
          />
        );
    }
  };

  if (loading) {
    return (
      <div className="modal-overlay">
        <div className="modal-content">
          <div style={{ padding: '20px', textAlign: 'center' }}>
            Loading form fields...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2 className="modal-title">Add New Bio-Digital System</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        
        <form onSubmit={handleSubmit}>
          {fields.map(field => (
            <div key={field.id} className="form-group">
              {field.type !== 'checkbox' && (
                <label className="form-label">{field.name}:</label>
              )}
              {renderField(field)}
              {field.description && (
                <small style={{ color: '#666', fontSize: '0.8em', display: 'block', marginTop: '2px' }}>
                  {field.description}
                </small>
              )}
            </div>
          ))}
          
          <div className="form-group">
            <button type="submit" className="btn">Add System</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddSystemForm;