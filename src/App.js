import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import AddSystemForm from './modals/AddSystemForm';
import { getAirtableFieldMetadata, generateOptionsFromData, addToAirtable } from './airtableMetadata';
import './styles/App.css';
import './styles/Modal.css';

// Configuration constants
const AIRTABLE_CONFIG = {
  baseId: 'appRiU9sw7RjOdGbk',
  token: 'patiiLJEXjP1oExM6.2b93f838d611daaab7c886ea6ebd86f6264ba697d2520d126ce8d344c9ddb8a6',
  tableId: 'tblYix3jMMM9MhIds'
};

// Single source of truth for field mapping - Airtable field names to internal field names
const FIELD_MAPPING = {
  'Project Title': 'name',
  'Author(s)/Creator(s)': 'author',
  'Image Link': 'img_name',
  'DOI': 'doi',
  'Year': 'year',
  'Genetically Modified': 'gmo',
  'Website Link': 'url',
  'Organism': 'organism',
  'Trigger': 'trigger', 
  'Observable Output of organism': 'output',
  'Scale': 'scale',
  'Response speed': 'temporality',
  'Temporal pattern(s)': 'temporality2',
  'Role of organism for digital': 'role-organism',
  'Role of digital for organism': 'role-digital',
  'Evolution over time': 'evolution'
};


const BioDigitalSankeyApp = () => {
  // Constants - derived from FIELD_MAPPING
  const allColumns = useMemo(() => {
    // Get internal field names that should be used in the visualization
    // Exclude 'id' and non-visualization fields like 'name', 'author', etc.
    const visualizationFields = ['organism', 'trigger', 'output', 'scale', 'temporality', 'temporality2', 'role-organism', 'role-digital'];
    return visualizationFields.filter(field => Object.values(FIELD_MAPPING).includes(field));
  }, []);
  
  const columnLabels = useMemo(() => [
    'Organism', 'Trigger', 'Observable Output', 'Scale', 'Speed', 'Temporal Pattern', 'Organism → Digital Role', 'Digital → Organism Role'
  ], []);

  // State
  const [data, setData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [visibleColumns, setVisibleColumns] = useState([...allColumns]);
  const [activeFilters, setActiveFilters] = useState([]);
  const [selectedFilterColumn, setSelectedFilterColumn] = useState('');
  const [selectedFilterValue, setSelectedFilterValue] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailContent, setDetailContent] = useState({ title: '', content: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [frozenHighlight, setFrozenHighlight] = useState(null);
  const [isFrozen, setIsFrozen] = useState(false);


  // Refs
  const svgRef = useRef();
  const currentGraph = useRef(null);
  const draggedElement = useRef(null);
  const containerRef = useRef();
  const clickTimeout = useRef(null);

  // Helper function to normalize field to array
  const normalizeToArray = useCallback((fieldValue) => {
    if (Array.isArray(fieldValue)) {
      return fieldValue.map(v => v.toString().trim()).filter(Boolean);
    } else if (typeof fieldValue === 'string') {
      return fieldValue.split(',').map(s => s.trim()).filter(Boolean);
    } else if (fieldValue) {
      return [fieldValue.toString().trim()];
    }
    return [];
  }, []);

  // Load data from Airtable
  const loadFromAirtable = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('Loading from Airtable...');
      const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.tableId}`, {
        headers: {
          'Authorization': `Bearer ${AIRTABLE_CONFIG.token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      
      if (!result.records || result.records.length === 0) {
        setError('No records found in Airtable');
        setLoading(false);
        return;
      }

      // Log available fields for debugging
      const firstRecord = result.records[0];
      const availableFields = Object.keys(firstRecord.fields);
      console.log('Available fields in Airtable:', availableFields);
      console.log('Expected fields:', Object.keys(FIELD_MAPPING));
      
      const processedData = result.records.map(record => {
        const fields = record.fields;
        
        // Start with required fields
        const system = {
          id: record.id
        };
        
        // Dynamically add all mapped fields
        Object.entries(FIELD_MAPPING).forEach(([airtableField, internalField]) => {
          const value = fields[airtableField];
          
          if (internalField === 'organism') {
            // Special handling for organism with GMO suffix
            const organismValues = normalizeToArray(value);
            const isGMO = fields[Object.keys(FIELD_MAPPING).find(key => FIELD_MAPPING[key] === 'gmo')];
            system[internalField] = organismValues.map(org => `${org}${isGMO ? ' (gmo)' : ''}`);
          } else if (['trigger', 'output', 'scale', 'temporality', 'temporality2', 'role-organism', 'role-digital'].includes(internalField)) {
            // Array fields
            system[internalField] = normalizeToArray(value);
          } else if (['author', 'img_name', 'url'].includes(internalField)) {
            // String fields that need trimming
            system[internalField] = (value || '').toString().trim();
          } else {
            // Default handling for other fields
            system[internalField] = value || (internalField === 'name' ? 'Unnamed System' : '');
          }
        });
        
        return system;
      }).filter(item => item.organism && item.organism.length > 0);

      setData(processedData);
      setLoading(false);
    } catch (error) {
      console.error('Error loading from Airtable:', error);
      setError(`Failed to load data: ${error.message}`);
      setLoading(false);
    }
  }, [normalizeToArray]); 

  const handleAddSystem = useCallback(async (airtableFormData) => {
    console.log('Handling add system with Airtable field names:', airtableFormData);
    
    try {
      const success = await addToAirtable(airtableFormData);
      if (success) {
        console.log('System added successfully!');
        setShowModal(false);
        await loadFromAirtable();
        return true;
      } else {
        console.error('Failed to add system.');
        return false;
      }
    } catch (error) {
      console.error('Error in handleAddSystem:', error);
      return false;
    }
  }, [loadFromAirtable]);

  // restore highlighting upon modal close
  const handleModalClose = () => {
    setShowDetailModal(false);
    
    // Restore frozen highlighting if it exists
    if (isFrozen && frozenHighlight) {
      setTimeout(() => {
        const allLinks = d3.selectAll('.link');
        const allNodes = d3.selectAll('.node rect');
        
        // Reset everything first
        allLinks
          .classed('flow-dimmed', true)
          .classed('flow-highlighted', false)
          .classed('flow-additional', false);
        
        allNodes
          .classed('node-dimmed', true)
          .classed('node-highlighted', false)
          .classed('node-additional', false);
        
        const targetSystemIds = frozenHighlight.map(s => s.name || JSON.stringify(s));
        
        // Restore blue highlighting
        currentGraph.current.nodes.forEach((n, nIndex) => {
          const matchingSystemsCount = n.systems.filter(nodeSystem => 
            targetSystemIds.includes(nodeSystem.name || JSON.stringify(nodeSystem))
          ).length;
          
          if (matchingSystemsCount > 0) {
            const nodeElement = d3.select(`[data-node-id="${nIndex}"]`);
            nodeElement
              .classed('node-dimmed', false)
              .classed('node-highlighted', true);
          }
        });
        
        currentGraph.current.links.forEach((link, linkIndex) => {
          const matchingSystemsCount = link.systems.filter(linkSystem => 
            targetSystemIds.includes(linkSystem.name || JSON.stringify(linkSystem))
          ).length;
          
          if (matchingSystemsCount > 0) {
            const strokeWidth = Math.max(2, matchingSystemsCount * 2);
            const linkElement = d3.select(`[data-link-id="${linkIndex}"]`);
            linkElement
              .classed('flow-dimmed', false)
              .classed('flow-highlighted', true)
              .style('stroke-width', `${strokeWidth}px`);
          }
        });
      }, 100);
    }
  };

  // Add filters
  const addFilter = () => {
    if (selectedFilterColumn && selectedFilterValue) {
      const newFilter = {
        id: Date.now(),
        column: selectedFilterColumn,
        value: selectedFilterValue,
        label: `${columnLabels[allColumns.indexOf(selectedFilterColumn)]}: ${selectedFilterValue}`
      };
      
      const exists = activeFilters.some(f => f.column === selectedFilterColumn && f.value === selectedFilterValue);
      if (!exists) {
        setActiveFilters(prev => [...prev, newFilter]);
      }
      
      setSelectedFilterColumn('');
      setSelectedFilterValue('');
    }
  };

  const removeFilter = (filterId) => {
    setActiveFilters(prev => prev.filter(f => f.id !== filterId));
  };

  const clearAllFilters = () => {
    setActiveFilters([]);
  };

  const getAvailableFilterValues = () => {
    if (!selectedFilterColumn) return [];
    return getOrderedValues(data, selectedFilterColumn, selectedFilterColumn);
  };

  // Enhanced highlighting with proper frozen state persistence
  const highlightCompleteFlows = useCallback((targetSystems, isFrozenHighlight = false, isAdditionalHighlight = false) => {
    if (!currentGraph.current) return;
    
    const allLinks = d3.selectAll('.link');
    const allNodes = d3.selectAll('.node rect');
    
    const targetSystemIds = targetSystems.map(s => s.name || JSON.stringify(s));
    
    if (isFrozenHighlight) {
      // This is setting a new frozen highlight - reset everything first
      allLinks
        .classed('flow-dimmed', true)
        .classed('flow-highlighted', false)
        .classed('flow-additional', false);
      
      allNodes
        .classed('node-dimmed', true)
        .classed('node-highlighted', false)
        .classed('node-additional', false);
      
      // Apply frozen highlighting (blue)
      currentGraph.current.links.forEach((link, linkIndex) => {
        const matchingSystemsCount = link.systems.filter(linkSystem => 
          targetSystemIds.includes(linkSystem.name || JSON.stringify(linkSystem))
        ).length;
        
        if (matchingSystemsCount > 0) {
          const strokeWidth = Math.max(2, matchingSystemsCount * 2);
          const linkElement = d3.select(`[data-link-id="${linkIndex}"]`);
          linkElement
            .classed('flow-dimmed', false)
            .classed('flow-highlighted', true)
            .style('stroke-width', `${strokeWidth}px`);
        }
      });
      
      currentGraph.current.nodes.forEach((node, nodeIndex) => {
        const matchingSystemsCount = node.systems.filter(nodeSystem => 
          targetSystemIds.includes(nodeSystem.name || JSON.stringify(nodeSystem))
        ).length;
        
        if (matchingSystemsCount > 0) {
          const nodeElement = d3.select(`[data-node-id="${nodeIndex}"]`);
          nodeElement
            .classed('node-dimmed', false)
            .classed('node-highlighted', true);
        }
      });
    } else if (isAdditionalHighlight && isFrozen) {
      // This is additional highlighting on top of frozen - only affect frozen elements
      allLinks.classed('flow-additional', false); // Reset previous additional
      allNodes.classed('node-additional', false);
      
      // Only apply additional highlighting to elements that are already frozen
      currentGraph.current.links.forEach((link, linkIndex) => {
        const linkElement = d3.select(`[data-link-id="${linkIndex}"]`);
        const isCurrentlyHighlighted = linkElement.classed('flow-highlighted');
        
        if (isCurrentlyHighlighted) {
          const matchingSystemsCount = link.systems.filter(linkSystem => 
            targetSystemIds.includes(linkSystem.name || JSON.stringify(linkSystem))
          ).length;
          
          if (matchingSystemsCount > 0) {
            linkElement.classed('flow-additional', true);
          }
        }
      });
      
      currentGraph.current.nodes.forEach((node, nodeIndex) => {
        const nodeElement = d3.select(`[data-node-id="${nodeIndex}"]`);
        const isCurrentlyHighlighted = nodeElement.classed('node-highlighted');
        
        if (isCurrentlyHighlighted) {
          const matchingSystemsCount = node.systems.filter(nodeSystem => 
            targetSystemIds.includes(nodeSystem.name || JSON.stringify(nodeSystem))
          ).length;
          
          if (matchingSystemsCount > 0) {
            nodeElement.classed('node-additional', true);
          }
        }
      });
    } else if (!isFrozen) {
      // Regular temporary highlighting when nothing is frozen
      allLinks
        .classed('flow-dimmed', true)
        .classed('flow-highlighted', false);
      
      allNodes
        .classed('node-dimmed', true)
        .classed('node-highlighted', false);
      
      currentGraph.current.links.forEach((link, linkIndex) => {
        const matchingSystemsCount = link.systems.filter(linkSystem => 
          targetSystemIds.includes(linkSystem.name || JSON.stringify(linkSystem))
        ).length;
        
        if (matchingSystemsCount > 0) {
          const strokeWidth = Math.max(2, matchingSystemsCount * 2);
          const linkElement = d3.select(`[data-link-id="${linkIndex}"]`);
          linkElement
            .classed('flow-dimmed', false)
            .classed('flow-highlighted', true)
            .style('stroke-width', `${strokeWidth}px`);
        }
      });
      
      currentGraph.current.nodes.forEach((node, nodeIndex) => {
        const matchingSystemsCount = node.systems.filter(nodeSystem => 
          targetSystemIds.includes(nodeSystem.name || JSON.stringify(nodeSystem))
        ).length;
        
        if (matchingSystemsCount > 0) {
          const nodeElement = d3.select(`[data-node-id="${nodeIndex}"]`);
          nodeElement
            .classed('node-dimmed', false)
            .classed('node-highlighted', true);
        }
      });
    }
  }, [isFrozen]);

  const resetHighlighting = useCallback((keepFrozen = false) => {
    if (!currentGraph.current) return;
    
    const allLinks = d3.selectAll('.link');
    const allNodes = d3.selectAll('.node rect');
    
    if (keepFrozen && isFrozen) {
      // Only reset additional highlights, keep frozen blue highlights
      allLinks.classed('flow-additional', false);
      allNodes.classed('node-additional', false);
    } else {
      // Reset everything including frozen
      currentGraph.current.links.forEach((link, linkIndex) => {
        const linkElement = d3.select(`[data-link-id="${linkIndex}"]`);
        const originalStrokeWidth = Math.max(2, link.value * 2);
        
        linkElement
          .classed('flow-dimmed', false)
          .classed('flow-highlighted', false)
          .classed('flow-additional', false)
          .style('stroke-width', `${originalStrokeWidth}px`);
      });
      
      allNodes
        .classed('node-dimmed', false)
        .classed('node-highlighted', false)
        .classed('node-additional', false);
      
      // Clear frozen state
      setIsFrozen(false);
      setFrozenHighlight(null);
    }
  }, [isFrozen]);

  const freezeHighlight = (systems) => {
    setFrozenHighlight(systems);
    setIsFrozen(true);
    highlightCompleteFlows(systems, true, false);
  };

  const unfreezeHighlight = () => {
    resetHighlighting(false);
  };

  // Sankey visualization utilities
  const createSankeyData = useCallback((systems) => {
    const nodes = [];
    const links = [];
    const nodeMap = new Map();

    console.log('=== DEBUG: Creating Sankey data ===');
    console.log('Visible columns:', visibleColumns);

    visibleColumns.forEach((column) => {
      let uniqueValues = [
        ...new Set(
          systems.flatMap(d => {
            return normalizeToArray(d[column]);
          }).filter(Boolean)
        )
      ];

      // Force temporality ordering with flexible matching
      if (column === 'temporality') {
        // Define time unit hierarchy (lower index = comes first)
        const timeUnits = ['second', 'minute', 'hour', 'day', 'week'];
        
        uniqueValues.sort((a, b) => {
          const aLower = a.toLowerCase();
          const bLower = b.toLowerCase();
          
          // Find which time unit each label contains
          const aUnitIndex = timeUnits.findIndex(unit => aLower.includes(unit));
          const bUnitIndex = timeUnits.findIndex(unit => bLower.includes(unit));
          
          // If both contain the same time unit, check for comparison operators
          if (aUnitIndex === bUnitIndex && aUnitIndex !== -1) {
            // Check for comparison operators: < or ≤ should come before >
            const aHasLessOrEqual = aLower.includes('<') || aLower.includes('≤');
            const bHasLessOrEqual = bLower.includes('<') || bLower.includes('≤');
            const aHasGreater = aLower.includes('>') && !aHasLessOrEqual;
            const bHasGreater = bLower.includes('>') && !bHasLessOrEqual;
            
            // If one has < or ≤ and the other has >, prioritize < or ≤
            if (aHasLessOrEqual && bHasGreater) return -1;
            if (bHasLessOrEqual && aHasGreater) return 1;
            
            // If both have same operator type or neither, sort alphabetically
            return a.localeCompare(b);
          }
          
          // If both contain the same time unit (or both contain none), sort alphabetically
          if (aUnitIndex === bUnitIndex) {
            return a.localeCompare(b);
          }
          
          // If one doesn't contain a recognized time unit, put it at the end
          if (aUnitIndex === -1) return 1;
          if (bUnitIndex === -1) return -1;
          
          // Otherwise, sort by time unit hierarchy
          return aUnitIndex - bUnitIndex;
        });
      } else if (column === 'scale') {
        // Define scale hierarchy from smallest to largest (lower index = comes first)
        const scaleUnits = ['subcell', 'cell', 'organism', 'population', 'ecosystem'];
        
        uniqueValues.sort((a, b) => {
          const aLower = a.toLowerCase();
          const bLower = b.toLowerCase();
          
          // Find which scale unit each label contains
          const aUnitIndex = scaleUnits.findIndex(unit => aLower.includes(unit));
          const bUnitIndex = scaleUnits.findIndex(unit => bLower.includes(unit));
          
          // If both contain the same scale unit (or both contain none), sort alphabetically
          if (aUnitIndex === bUnitIndex) {
            return a.localeCompare(b);
          }
          
          // If one doesn't contain a recognized scale unit, put it at the end
          if (aUnitIndex === -1) return 1;
          if (bUnitIndex === -1) return -1;
          
          // Otherwise, sort by scale hierarchy
          return aUnitIndex - bUnitIndex;
        });
      } else if (column === 'role-organism' || column === 'role-digital') {
        // Custom ordering for role columns: input (top) -> others -> output -> power -> none (bottom)
        uniqueValues.sort((a, b) => {
          const aLower = a.toLowerCase();
          const bLower = b.toLowerCase();
          
          // Define priority order
          const getOrder = (value) => {
            if (value.startsWith('input')) return 0;      // Top
            if (value.startsWith('output')) return 2;     // Above power
            if (value.startsWith('power')) return 3;      // Above none
            if (value === 'none') return 4;               // Bottom
            return 1;                                     // Everything else in middle
          };
          
          const aOrder = getOrder(aLower);
          const bOrder = getOrder(bLower);
          
          // If same priority group, sort alphabetically
          if (aOrder === bOrder) {
            return a.localeCompare(b);
          }
          
          // Otherwise sort by priority order
          return aOrder - bOrder;
        });
      } else {
        uniqueValues.sort();
      }

      uniqueValues.forEach(value => {
        const nodeId = `${column}-${value}`;
        const relatedSystems = systems.filter(d => {
          const systemValues = normalizeToArray(d[column]);
          return systemValues.includes(value);
        });
        const node = {
          id: nodeId,
          name: value,
          category: column,
          value: relatedSystems.length,
          systems: relatedSystems
        };
        nodes.push(node);
        nodeMap.set(nodeId, node);
      });
    });

    console.log('Created nodes:', nodes.length);
    console.log('Node map size:', nodeMap.size);

    systems.forEach(system => {
      for (let i = 0; i < visibleColumns.length - 1; i++) {
        const colA = visibleColumns[i];
        const colB = visibleColumns[i + 1];
        
        const valuesA = normalizeToArray(system[colA]);
        const valuesB = normalizeToArray(system[colB]);

        valuesA.forEach(sourceValue => {
          valuesB.forEach(targetValue => {
            if (!sourceValue || !targetValue) return;
            
            const sourceId = `${colA}-${sourceValue}`;
            const targetId = `${colB}-${targetValue}`;
            
            const existingLink = links.find(l => l.source.id === sourceId && l.target.id === targetId);

            if (existingLink) {
              existingLink.value += 1;
              existingLink.systems.push(system);
            } else {
              const sourceNode = nodeMap.get(sourceId);
              const targetNode = nodeMap.get(targetId);
              
              if (sourceNode && targetNode) {
                links.push({
                  source: sourceNode,
                  target: targetNode,
                  value: 1,
                  systems: [system]
                });
              } else {
                console.warn(`  ✗ Missing nodes for link: ${sourceId} -> ${targetId}`);
              }
            }
          });
        });
      }
    });

    return { nodes, links };
  }, [visibleColumns, normalizeToArray]);

  const createLinkPath = (source, target) => {
    const x0 = source.x + source.width;
    const x1 = target.x;
    const y0 = source.y + source.height / 2;
    const y1 = target.y + target.height / 2;
    
    const xi = d3.interpolateNumber(x0, x1);
    const x2 = xi(0.5);
    const x3 = xi(0.5);
    
    return `M${x0},${y0}C${x2},${y0} ${x3},${y1} ${x1},${y1}`;
  };

  // Consolidated function for showing system details (reduces redundancy)
  const generateSystemDetailsHTML = useCallback((systems) => {
    let content = `
      <p><strong>Related Systems (${systems.length}):</strong></p>
    `;
    
    systems.forEach(system => {
      let imgTag = '';
      if (system.img_name) {
        const isExternalUrl = system.img_name.startsWith('http://') || system.img_name.startsWith('https://') || system.img_name.startsWith('www.');
        const imgSrc = isExternalUrl ? system.img_name : `${process.env.PUBLIC_URL}/images/${system.img_name}`;
        imgTag = `<img src="${imgSrc}" alt="${system.name}" class="system-thumb" />`;
      }

      content += `
        <div class="system-detail">
          <h4><a href="${system.url}" target="_blank" rel="noopener noreferrer" class="link-unstyled">${system.name}${system.author ? ` (${system.author})` : ''}</a></h4>
          <div class="system-detail-grid">
            <div>
              <p>${imgTag}</p>
            </div>
            <div>
              <p><strong>Organism:</strong> ${Array.isArray(system.organism) ? system.organism.join(', ') : system.organism}</p>
              <p><strong>Trigger:</strong> ${Array.isArray(system.trigger) ? system.trigger.join(', ') : system.trigger}</p>
              <p><strong>Output:</strong> ${Array.isArray(system.output) ? system.output.join(', ') : system.output}</p>
              <p><strong>Scale:</strong> ${Array.isArray(system.scale) ? system.scale.join(', ') : system.scale}</p>
            </div>
            <div>
              <p><strong>Temporality:</strong> ${Array.isArray(system.temporality) ? system.temporality.join(', ') : system.temporality}</p>
              <p><strong>Temporal Pattern:</strong> ${Array.isArray(system.temporality2) ? system.temporality2.join(', ') : system.temporality2}</p>
              <p><strong>Organism Role (for Digital):</strong> ${Array.isArray(system['role-organism']) ? system['role-organism'].join(', ') : system['role-organism']}</p>
              <p><strong>Digital Role (for Organism):</strong> ${Array.isArray(system['role-digital']) ? system['role-digital'].join(', ') : system['role-digital']}</p>
            </div>
          </div>
        </div>
      `;
    });
    
    return content;
  }, []);

  // Event Handlers (now using consolidated function)
  const showNodeDetails = useCallback((node) => {
    const content = generateSystemDetailsHTML(node.systems);
    setDetailContent({
      title: `${columnLabels[allColumns.indexOf(node.category)]}: ${node.name}`,
      content
    });
    setShowDetailModal(true);
  }, [allColumns, columnLabels, generateSystemDetailsHTML]);

  const showLinkDetails = useCallback((link) => {
    const content = generateSystemDetailsHTML(link.systems);
    
    setDetailContent({
      title: `(${link.source.category}:${link.source.name}) ↔ (${link.target.category}:${link.target.name})`,
      content
    });
    setShowDetailModal(true);
  }, [generateSystemDetailsHTML]);

  // Form and interaction handlers
  const handleColumnToggle = (column) => {
    const newVisibleColumns = visibleColumns.includes(column)
      ? visibleColumns.filter(col => col !== column)
      : [...visibleColumns, column];
    
    if (newVisibleColumns.length < 2) {
      alert('At least 2 columns must be visible');
      return;
    }
    
    setVisibleColumns(newVisibleColumns);
  };

  const handleColumnReorder = useCallback((draggedColumn, targetColumn) => {
    if (draggedColumn && draggedColumn !== targetColumn) {
      const newColumns = [...visibleColumns];
      const draggedIndex = newColumns.indexOf(draggedColumn);
      const targetIndex = newColumns.indexOf(targetColumn);
      
      // Remove dragged column from its current position
      newColumns.splice(draggedIndex, 1);
      
      // Insert it at the target position
      newColumns.splice(targetIndex, 0, draggedColumn);
      
      setVisibleColumns(newColumns);
    }
  }, [visibleColumns]);

  const drawSankey = useCallback(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    if (filteredData.length === 0) {
      svg.append('text')
        .attr('x', '50%')
        .attr('y', '50%')
        .attr('text-anchor', 'middle')
        .text(loading ? 'Loading data...' : (error || 'No data to display.'));
      return;
    }

    // Calculate available viewport height dynamically
    const headerHeight = 80; // Approximate height of title
    const controlsHeight = 60; // Height of control buttons
    const filtersHeight = 60; // Height of filter section
    const statsHeight = 40; // Height of stats section
    const padding = 40; // Extra padding

    const availableHeight = window.innerHeight - headerHeight - controlsHeight - filtersHeight - statsHeight - padding;
    
    // Get container dimensions for responsiveness
    const containerWidth = containerRef.current ? containerRef.current.clientWidth - 40 : 1200;
    const width = Math.max(800, containerWidth);
    const height = Math.max(500, availableHeight); // Minimum height of 400px
    const margin = { top: 60, right: 80, bottom: 0, left: 100 };

    // Update SVG dimensions
    svg.attr('width', width).attr('height', height);

    // Add background click handler to unfreeze when clicking outside
    svg.on('click', function(event) {
      // Check if the click was directly on the SVG background (not on any child elements)
      if (event.target === svg.node()) {
        if (isFrozen) {
          console.log('Clicked outside - unfreezing');
          unfreezeHighlight();
        }
      }
    });

    // Create zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.5, 3])
      .on('zoom', function(event) {
        mainGroup.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Create main group for zooming/panning
    const mainGroup = svg.append('g').attr('class', 'main-group');

    // Set default zoom level (zoomed out) - must be after mainGroup is created
    const defaultScale = 1; // Adjust this value (0.5 = very zoomed out, 1.0 = normal, 1.5 = zoomed in)
    const panX = -75;  // Positive = pan right, negative = pan left
    const panY = -25;   // Positive = pan down, negative = pan up
    const defaultTransform = d3.zoomIdentity
      .translate(panX, panY)
      .scale(defaultScale);
    svg.call(zoom.transform, defaultTransform);

    const graph = createSankeyData(filteredData);
    currentGraph.current = graph;
    
    const nodeWidth = 15;
    const availableWidth = width - margin.left - margin.right;
    const columnWidth = availableWidth / Math.max(1, visibleColumns.length - 1);
    
    // Position nodes with proper alignment
    visibleColumns.forEach((column, columnIndex) => {
      const nodesInColumn = graph.nodes.filter(n => n.category === column);
      const totalHeight = height - margin.top - margin.bottom;
      
      const nodeHeight = 20;
      const numNodes = nodesInColumn.length;

      // Compute dynamic padding so nodes + padding fills the column
      const totalNodeSpace = numNodes * nodeHeight;
      const nodePadding = numNodes > 1
        ? (totalHeight - totalNodeSpace) / (numNodes - 1)
        : 0;

      nodesInColumn.forEach((node, nodeIndex) => {
        node.x = margin.left + (visibleColumns.length === 1 ? 0 : columnIndex * columnWidth);
        node.y = margin.top + nodeIndex * (nodeHeight + nodePadding);
        node.height = nodeHeight;  // ← uniform height
        node.width = nodeWidth;        
      });
    });

    // Add column labels (inside the zoomable group) - make them draggable
    const columnLabelsGroup = mainGroup.append('g').attr('class', 'column-labels');
    
    visibleColumns.forEach((column, columnIndex) => {
      const labelX = margin.left + (visibleColumns.length === 1 ? 0 : columnIndex * columnWidth) + nodeWidth / 2;
      const labelY = margin.top - 20;
      
      const labelGroup = columnLabelsGroup.append('g')
        .attr('class', 'column-label-group')
        .style('cursor', 'move');
      
      // Background rectangle for better drag target
      labelGroup.append('rect')
        .attr('x', labelX - 50)
        .attr('y', labelY - 15)
        .attr('width', 100)
        .attr('height', 25)
        .attr('fill', 'transparent')
      
      labelGroup.append('text')
        .attr('x', labelX)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .style('font-weight', '800')
        .text(columnLabels[allColumns.indexOf(column)]);
      
      // Add drag functionality to the label group with proper positioning
      labelGroup
        .call(d3.drag()
          .on('start', function (event) {
            draggedElement.current = column;
            d3.select(this).style('opacity', 0.7);
            d3.select(this).attr('data-start-x', event.x); // Save actual mouse x
          })
          .on('drag', function (event) {
            const startX = parseFloat(d3.select(this).attr('data-start-x')) || event.x;
            const deltaX = event.x - startX;
            
            // Move the label
            d3.select(this).attr('transform', `translate(${deltaX}, 0)`);
            
            // Move the entire column (nodes and their labels)
            const columnNodes = graph.nodes.filter(n => n.category === column);
            columnNodes.forEach((node, nodeIndex) => {
              const nodeElement = d3.select(`[data-node-id="${graph.nodes.indexOf(node)}"]`);
              const nodeGroup = nodeElement.node().parentNode;
              d3.select(nodeGroup).attr('transform', `translate(${deltaX}, 0)`);
            });
            
            // Redraw links connected to this column with updated positions
            graph.links.forEach((link, linkIndex) => {
              if (link.source.category === column || link.target.category === column) {
                const linkElement = d3.select(`[data-link-id="${linkIndex}"]`);
                
                // Calculate new path with offset
                let source = link.source;
                let target = link.target;
                
                if (link.source.category === column) {
                  source = { ...link.source, x: link.source.x + deltaX };
                }
                if (link.target.category === column) {
                  target = { ...link.target, x: link.target.x + deltaX };
                }
                
                const newPath = createLinkPath(source, target);
                linkElement.attr('d', newPath);
              }
            });
          })
          .on('end', function (event) {
            const startX = parseFloat(d3.select(this).attr('data-start-x'));
            const deltaX = event.x - startX;
            const originalIndex = visibleColumns.indexOf(column);
            
            // Calculate the dragged column's current midpoint position
            const originalMidX = margin.left + originalIndex * columnWidth + columnWidth / 2;
            const draggedMidX = originalMidX + deltaX;

            // Find the target position by checking which column midpoint we've crossed
            let targetIndex = originalIndex;
            let willReorder = false;

            // Create array of column midpoints with their indices
            const columnPositions = visibleColumns.map((col, i) => ({
              column: col,
              index: i,
              midX: margin.left + i * columnWidth + columnWidth / 2
            }));

            // Sort by midpoint position to process left to right
            columnPositions.sort((a, b) => a.midX - b.midX);

            // Find where the dragged midpoint should be inserted
            for (let i = 0; i < columnPositions.length; i++) {
              const pos = columnPositions[i];
              
              // Skip the dragged column itself
              if (pos.index === originalIndex) continue;
              
              if (draggedMidX < pos.midX) {
                // The dragged column should be inserted before this position
                targetIndex = pos.index;
                willReorder = (targetIndex !== originalIndex);
                break;
              } else if (i === columnPositions.length - 1) {
                // We've passed all columns, insert at the end
                targetIndex = visibleColumns.length - 1;
                willReorder = (targetIndex !== originalIndex);
              }
            }

            // Alternative simpler approach: find closest column midpoint
            if (!willReorder) {
              let minDistance = Infinity;
              let closestIndex = originalIndex;
              
              for (let i = 0; i < visibleColumns.length; i++) {
                if (i === originalIndex) continue;
                
                const columnMidX = margin.left + i * columnWidth + columnWidth / 2;
                const distance = Math.abs(draggedMidX - columnMidX);
                
                if (distance < minDistance && distance < columnWidth / 2) {
                  minDistance = distance;
                  closestIndex = i;
                  
                  // Determine if we should insert before or after this column
                  if (draggedMidX < columnMidX) {
                    // Insert before this column
                    targetIndex = i;
                  } else {
                    // Insert after this column
                    targetIndex = i + 1;
                    if (targetIndex > originalIndex) targetIndex--; // Adjust for removal
                  }
                  willReorder = true;
                }
              }
            }

            // Smooth animated transition back to final positions
            const transitionDuration = willReorder ? 350 : 200;
            
            // Animate label back to position
            d3.select(this)
              .transition()
              .duration(transitionDuration)
              .ease(d3.easeQuadOut)
              .style('opacity', 1)
              .attr('transform', null);

            // Animate column nodes back to position
            const columnNodes = graph.nodes.filter(n => n.category === column);
            columnNodes.forEach((node, nodeIndex) => {
              const nodeElement = d3.select(`[data-node-id="${graph.nodes.indexOf(node)}"]`);
              const nodeGroup = nodeElement.node().parentNode;
              
              // Animate node group transform back to original position
              d3.select(nodeGroup)
                .transition()
                .duration(transitionDuration)
                .ease(d3.easeQuadOut)
                .attr('transform', null);
            });
            
            // Execute reorder if crossing occurred
            if (willReorder) {
              setTimeout(() => {
                // Create new column order
                const newColumns = [...visibleColumns];
                
                // Remove the dragged column from its current position
                newColumns.splice(originalIndex, 1);
                
                // Adjust target index if we removed an item before it
                const adjustedTargetIndex = targetIndex > originalIndex ? targetIndex - 1 : targetIndex;
                
                // Ensure target index is within bounds
                const finalTargetIndex = Math.max(0, Math.min(adjustedTargetIndex, newColumns.length));
                
                // Insert the column at the new position
                newColumns.splice(finalTargetIndex, 0, column);
                
                // Update the visible columns state
                setVisibleColumns(newColumns);
              }, 50);
            } else {
              // If not reordering, just fix the links after animation
              setTimeout(() => {
                // Redraw all links to ensure they're properly positioned
                graph.links.forEach((link, linkIndex) => {
                  const linkElement = d3.select(`[data-link-id="${linkIndex}"]`);
                  linkElement.attr('d', createLinkPath(link.source, link.target));
                });
              }, transitionDuration);
            }

            draggedElement.current = null;
          })
        );
      });

    // Add vertical dotted line before role-digital column
    const roleDigitalIndex = visibleColumns.indexOf('role-digital');
    if (roleDigitalIndex > 0) {
      const lineX = margin.left + (roleDigitalIndex - 0.4) * columnWidth;
      mainGroup.append('line')
        .attr('x1', lineX)
        .attr('x2', lineX)
        .attr('y1', margin.top)
        .attr('y2', height - margin.bottom)
        .attr('stroke', '#666666')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,4')
        .style('opacity', 0.7);
    }

    const colorScale = d3.scaleOrdinal()
      .domain(visibleColumns)
      .range(['#bbbbbb']);

    // Create tooltip
    const tooltip = d3.select('body')
      .selectAll('.tooltip')
      .data([0])
      .join('div')
      .attr('class', 'tooltip')
      .classed('tooltip', true)

    // Draw links
    const linkGroup = mainGroup.append('g').attr('class', 'links');
    
    graph.links.forEach((link, linkIndex) => {
      linkGroup.append('path')
        .attr('class', 'link')
        .attr('data-link-id', linkIndex)
        .attr('d', createLinkPath(link.source, link.target))
        .attr('stroke', colorScale(link.source.category))
        .style('stroke-width', Math.max(2, link.value * 2) + 'px')
        .attr('data-original-stroke', Math.max(2, link.value * 2)) // Store original for reset
        .attr('fill', 'none')
        .style('opacity', 0.5)
        .style('cursor', 'pointer')
        .on('mouseover', function(event) {
          if (!isFrozen) {
            highlightCompleteFlows(link.systems);
          } else {
            // Check if this link is already highlighted (blue)
            const linkElement = d3.select(`[data-link-id="${linkIndex}"]`);
            const isHighlighted = linkElement.classed('flow-highlighted');
            
            if (isHighlighted && frozenHighlight) {
              // Only consider the intersection of hovered systems with frozen systems
              const frozenSystemIds = frozenHighlight.map(s => s.name || JSON.stringify(s));
              const hoveredSystemIds = link.systems.map(s => s.name || JSON.stringify(s));
              const intersectionSystemIds = hoveredSystemIds.filter(id => frozenSystemIds.includes(id));
              
              console.log('Link hover - frozen systems:', frozenSystemIds.length, 'hovered systems:', hoveredSystemIds.length, 'intersection:', intersectionSystemIds.length);
              
              if (intersectionSystemIds.length > 0) {
                // Reset previous additional highlighting and restore blue widths
                d3.selectAll('.link').each(function() {
                  const linkEl = d3.select(this);
                  if (linkEl.classed('flow-additional')) {
                    const originalWidth = linkEl.attr('data-blue-width');
                    if (originalWidth) {
                      linkEl.style('stroke-width', originalWidth + 'px');
                    }
                  }
                  linkEl.classed('flow-additional', false);
                });
                d3.selectAll('.node rect').classed('node-additional', false);
                
                let greenNodesCount = 0;
                let greenLinksCount = 0;
                
                // Apply green highlighting
                currentGraph.current.nodes.forEach((n, nIndex) => {
                  const nodeEl = d3.select(`[data-node-id="${nIndex}"]`);
                  const isBlueHighlighted = nodeEl.classed('node-highlighted');
                  
                  if (isBlueHighlighted) {
                    const nodeSystemIds = n.systems.map(s => s.name || JSON.stringify(s));
                    const nodeIntersectionCount = nodeSystemIds.filter(id => intersectionSystemIds.includes(id)).length;
                    
                    if (nodeIntersectionCount > 0) {
                      nodeEl.classed('node-additional', true);
                      greenNodesCount++;
                    }
                  }
                });
                
                currentGraph.current.links.forEach((link, linkIndex) => {
                  const linkEl = d3.select(`[data-link-id="${linkIndex}"]`);
                  const isBlueHighlighted = linkEl.classed('flow-highlighted');
                  
                  if (isBlueHighlighted) {
                    const linkSystemIds = link.systems.map(s => s.name || JSON.stringify(s));
                    const linkIntersectionCount = linkSystemIds.filter(id => intersectionSystemIds.includes(id)).length;
                    
                    if (linkIntersectionCount > 0) {
                      // Store the current blue width before changing
                      const currentWidth = linkEl.style('stroke-width').replace('px', '');
                      linkEl.attr('data-blue-width', currentWidth);
                      
                      // Each link gets width based on how many intersection systems flow through IT
                      const greenStrokeWidth = Math.max(2, linkIntersectionCount * 2);
                      
                      linkEl
                        .classed('flow-additional', true)
                        .style('stroke-width', `${greenStrokeWidth}px`);
                      greenLinksCount++;
                    }
                  }
                });
                
                console.log(`Applied green to ${greenNodesCount} nodes and ${greenLinksCount} links with individual widths`);
              }
            }
          }
          
          // Show tooltip with intersection count when frozen
          const linkElement = d3.select(`[data-link-id="${linkIndex}"]`);
          const shouldShowTooltip = !isFrozen || linkElement.classed('flow-highlighted');
          
          if (shouldShowTooltip) {
            let tooltipContent;
            if (isFrozen && frozenHighlight) {
              // Show only intersection systems count
              const frozenSystemIds = frozenHighlight.map(s => s.name || JSON.stringify(s));
              const linkSystemIds = link.systems.map(s => s.name || JSON.stringify(s));
              const intersectionCount = linkSystemIds.filter(id => frozenSystemIds.includes(id)).length;
              
              tooltipContent = `<strong>(${link.source.category}:${link.source.name}) + (${link.target.category}:${link.target.name})</strong><br/>Frozen subset: ${intersectionCount} systems<br/>Click to unfreeze, double-click to explore subset`;
            } else {
              tooltipContent = `<strong>(${link.source.category}:${link.source.name}) + (${link.target.category}:${link.target.name})</strong><br/>Systems: ${link.value}<br/>Click to freeze/unfreeze, double-click to explore connections`;
            }
            
            tooltip
              .style('opacity', 1)
              .html(tooltipContent)
              .style('left', (event.pageX + 10) + 'px')
              .style('top', (event.pageY - 28) + 'px');
          }
        })
        .on('mouseout', function() {
          if (!isFrozen) {
            resetHighlighting();
          } else {
            // Restore blue widths and remove green
            d3.selectAll('.link').each(function() {
              const linkEl = d3.select(this);
              if (linkEl.classed('flow-additional')) {
                const originalWidth = linkEl.attr('data-blue-width');
                if (originalWidth) {
                  linkEl.style('stroke-width', originalWidth + 'px');
                }
                linkEl.classed('flow-additional', false);
              }
            });
            d3.selectAll('.node rect').classed('node-additional', false);
          }
          tooltip.style('opacity', 0);
        })
        .on('click', function() {
          // Clear any existing timeout
          if (clickTimeout.current) {
            clearTimeout(clickTimeout.current);
            clickTimeout.current = null;
            return; // This was a double-click, don't process as single click
          }
          
          // Set a timeout for single click
          clickTimeout.current = setTimeout(() => {
            console.log('Link clicked, current isFrozen:', isFrozen);
            if (isFrozen) {
              console.log('Unfreezing...');
              unfreezeHighlight();
            } else {
              console.log('Freezing link with systems:', link.systems.length);
              setFrozenHighlight(link.systems);
              setIsFrozen(true);
              
              // Apply highlighting directly here
              setTimeout(() => {
                const allLinks = d3.selectAll('.link');
                const allNodes = d3.selectAll('.node rect');
                
                allLinks
                  .classed('flow-dimmed', true)
                  .classed('flow-highlighted', false)
                  .classed('flow-additional', false);
                
                allNodes
                  .classed('node-dimmed', true)
                  .classed('node-highlighted', false)
                  .classed('node-additional', false);
                
                const targetSystemIds = link.systems.map(s => s.name || JSON.stringify(s));
                
                // Highlight ALL nodes that contain the target systems
                currentGraph.current.nodes.forEach((n, nIndex) => {
                  const matchingSystemsCount = n.systems.filter(nodeSystem => 
                    targetSystemIds.includes(nodeSystem.name || JSON.stringify(nodeSystem))
                  ).length;
                  
                  if (matchingSystemsCount > 0) {
                    const nodeElement = d3.select(`[data-node-id="${nIndex}"]`);
                    nodeElement
                      .classed('node-dimmed', false)
                      .classed('node-highlighted', true);
                  }
                });
                
                // Highlight ALL links that contain the target systems
                currentGraph.current.links.forEach((l, lIndex) => {
                  const matchingSystemsCount = l.systems.filter(linkSystem => 
                    targetSystemIds.includes(linkSystem.name || JSON.stringify(linkSystem))
                  ).length;
                  
                  if (matchingSystemsCount > 0) {
                    const strokeWidth = Math.max(2, matchingSystemsCount * 2);
                    const linkElement = d3.select(`[data-link-id="${lIndex}"]`);
                    linkElement
                      .classed('flow-dimmed', false)
                      .classed('flow-highlighted', true)
                      .style('stroke-width', `${strokeWidth}px`);
                  }
                });
                
                console.log('Applied link highlighting directly');
              }, 100);
            }
            clickTimeout.current = null;
          }, 200); // 200ms delay to distinguish from double-click
        })
        .on('dblclick', function(event) {
          event.stopPropagation();
          
          if (clickTimeout.current) {
            clearTimeout(clickTimeout.current);
            clickTimeout.current = null;
          }
          
          const linkElement = d3.select(`[data-link-id="${linkIndex}"]`);
          const shouldShowDetails = !isFrozen || linkElement.classed('flow-highlighted');
          
          if (shouldShowDetails) {
            if (isFrozen && frozenHighlight) {
              // Show only the intersection of link systems with frozen systems
              const frozenSystemIds = frozenHighlight.map(s => s.name || JSON.stringify(s));
              const intersectionSystems = link.systems.filter(linkSystem => 
                frozenSystemIds.includes(linkSystem.name || JSON.stringify(linkSystem))
              );
              showLinkDetails({ ...link, systems: intersectionSystems });
            } else {
              showLinkDetails(link);
            }
          }
        })
    });

    // Draw nodes
    const nodeGroup = mainGroup.append('g').attr('class', 'nodes');
    
    graph.nodes.forEach((node, nodeIndex) => {
      if (visibleColumns.indexOf(node.category) === -1) return;
      
      const nodeElement = nodeGroup.append('g').attr('class', 'node');

      nodeElement.append('rect')
        .attr('data-node-id', nodeIndex)
        .attr('x', node.x)
        .attr('y', node.y)
        .attr('width', node.width)
        .attr('height', node.height)
        .attr('fill', colorScale(node.category))
        .style('cursor', 'pointer')
        .on('mouseover', function(event) {
          if (!isFrozen) {
            highlightCompleteFlows(node.systems);
          } else {
            // Check if this node is already highlighted (blue)
            const nodeElement = d3.select(`[data-node-id="${nodeIndex}"]`);
            const isHighlighted = nodeElement.classed('node-highlighted');
            
            if (isHighlighted && frozenHighlight) {
              // Only consider the intersection of hovered systems with frozen systems
              const frozenSystemIds = frozenHighlight.map(s => s.name || JSON.stringify(s));
              const hoveredSystemIds = node.systems.map(s => s.name || JSON.stringify(s));
              const intersectionSystemIds = hoveredSystemIds.filter(id => frozenSystemIds.includes(id));
              
              console.log('Node hover - frozen systems:', frozenSystemIds.length, 'hovered systems:', hoveredSystemIds.length, 'intersection:', intersectionSystemIds.length);
              
              if (intersectionSystemIds.length > 0) {
                // Reset previous additional highlighting and restore blue widths
                d3.selectAll('.link').each(function() {
                  const linkEl = d3.select(this);
                  if (linkEl.classed('flow-additional')) {
                    const originalWidth = linkEl.attr('data-blue-width');
                    if (originalWidth) {
                      linkEl.style('stroke-width', originalWidth + 'px');
                    }
                  }
                  linkEl.classed('flow-additional', false);
                });
                d3.selectAll('.node rect').classed('node-additional', false);
                
                let greenNodesCount = 0;
                let greenLinksCount = 0;
                
                // Apply green highlighting
                currentGraph.current.nodes.forEach((n, nIndex) => {
                  const nodeEl = d3.select(`[data-node-id="${nIndex}"]`);
                  const isBlueHighlighted = nodeEl.classed('node-highlighted');
                  
                  if (isBlueHighlighted) {
                    const nodeSystemIds = n.systems.map(s => s.name || JSON.stringify(s));
                    const nodeIntersectionCount = nodeSystemIds.filter(id => intersectionSystemIds.includes(id)).length;
                    
                    if (nodeIntersectionCount > 0) {
                      nodeEl.classed('node-additional', true);
                      greenNodesCount++;
                    }
                  }
                });
                
                currentGraph.current.links.forEach((link, linkIndex) => {
                  const linkEl = d3.select(`[data-link-id="${linkIndex}"]`);
                  const isBlueHighlighted = linkEl.classed('flow-highlighted');
                  
                  if (isBlueHighlighted) {
                    const linkSystemIds = link.systems.map(s => s.name || JSON.stringify(s));
                    const linkIntersectionCount = linkSystemIds.filter(id => intersectionSystemIds.includes(id)).length;
                    
                    if (linkIntersectionCount > 0) {
                      // Store the current blue width before changing
                      const currentWidth = linkEl.style('stroke-width').replace('px', '');
                      linkEl.attr('data-blue-width', currentWidth);
                      
                      // Each link gets width based on how many intersection systems flow through IT
                      const greenStrokeWidth = Math.max(2, linkIntersectionCount * 2);
                      
                      linkEl
                        .classed('flow-additional', true)
                        .style('stroke-width', `${greenStrokeWidth}px`);
                      greenLinksCount++;
                    }
                  }
                });
                
                console.log(`Applied green to ${greenNodesCount} nodes and ${greenLinksCount} links with individual widths`);
              }
            }
          }
          
          // Show tooltip with intersection count when frozen
          const nodeElement = d3.select(`[data-node-id="${nodeIndex}"]`);
          const shouldShowTooltip = !isFrozen || nodeElement.classed('node-highlighted');
          
          if (shouldShowTooltip) {
            let tooltipContent;
            if (isFrozen && frozenHighlight) {
              // Show only intersection systems count
              const frozenSystemIds = frozenHighlight.map(s => s.name || JSON.stringify(s));
              const nodeSystemIds = node.systems.map(s => s.name || JSON.stringify(s));
              const intersectionCount = nodeSystemIds.filter(id => frozenSystemIds.includes(id)).length;
              
              tooltipContent = `<strong>${node.name}</strong><br/>Category: ${node.category}<br/>Frozen subset: ${intersectionCount} systems<br/>Click to unfreeze, double-click to explore subset`;
            } else {
              tooltipContent = `<strong>${node.name}</strong><br/>Category: ${node.category}<br/>Connected systems: ${node.value}<br/>Click to freeze/unfreeze, double-click to explore`;
            }
            
            tooltip
              .style('opacity', 1)
              .html(tooltipContent)
              .style('left', (event.pageX + 10) + 'px')
              .style('top', (event.pageY - 28) + 'px');
          }
        })
        .on('mouseout', function() {
          if (!isFrozen) {
            resetHighlighting();
          } else {
            // Restore blue widths and remove green
            d3.selectAll('.link').each(function() {
              const linkEl = d3.select(this);
              if (linkEl.classed('flow-additional')) {
                const originalWidth = linkEl.attr('data-blue-width');
                if (originalWidth) {
                  linkEl.style('stroke-width', originalWidth + 'px');
                }
                linkEl.classed('flow-additional', false);
              }
            });
            d3.selectAll('.node rect').classed('node-additional', false);
          }
          tooltip.style('opacity', 0);
        })
        .on('click', function() {
          // Clear any existing timeout
          if (clickTimeout.current) {
            clearTimeout(clickTimeout.current);
            clickTimeout.current = null;
            return; // This was a double-click, don't process as single click
          }
          
          // Set a timeout for single click
          clickTimeout.current = setTimeout(() => {
            console.log('Node clicked, current isFrozen:', isFrozen);
            if (isFrozen) {
              console.log('Unfreezing...');
              unfreezeHighlight();
            } else {
              console.log('Freezing node with systems:', node.systems.length);
              setFrozenHighlight(node.systems);
              setIsFrozen(true);
              
              // Apply highlighting directly here
              setTimeout(() => {
                const allLinks = d3.selectAll('.link');
                const allNodes = d3.selectAll('.node rect');
                
                allLinks
                  .classed('flow-dimmed', true)
                  .classed('flow-highlighted', false)
                  .classed('flow-additional', false);
                
                allNodes
                  .classed('node-dimmed', true)
                  .classed('node-highlighted', false)
                  .classed('node-additional', false);
                
                const targetSystemIds = node.systems.map(s => s.name || JSON.stringify(s));
                
                // Highlight ALL nodes that contain the target systems
                currentGraph.current.nodes.forEach((n, nIndex) => {
                  const matchingSystemsCount = n.systems.filter(nodeSystem => 
                    targetSystemIds.includes(nodeSystem.name || JSON.stringify(nodeSystem))
                  ).length;
                  
                  if (matchingSystemsCount > 0) {
                    const nodeElement = d3.select(`[data-node-id="${nIndex}"]`);
                    nodeElement
                      .classed('node-dimmed', false)
                      .classed('node-highlighted', true);
                  }
                });
                
                // Highlight related links
                currentGraph.current.links.forEach((link, linkIndex) => {
                  const matchingSystemsCount = link.systems.filter(linkSystem => 
                    targetSystemIds.includes(linkSystem.name || JSON.stringify(linkSystem))
                  ).length;
                  
                  if (matchingSystemsCount > 0) {
                    const strokeWidth = Math.max(2, matchingSystemsCount * 2);
                    const linkElement = d3.select(`[data-link-id="${linkIndex}"]`);
                    linkElement
                      .classed('flow-dimmed', false)
                      .classed('flow-highlighted', true)
                      .style('stroke-width', `${strokeWidth}px`);
                  }
                });
                
                console.log('Applied highlighting directly');
              }, 100);
            }
            clickTimeout.current = null;
          }, 200); // 200ms delay to distinguish from double-click
        })
        .on('dblclick', function(event) {
          event.stopPropagation();
          
          if (clickTimeout.current) {
            clearTimeout(clickTimeout.current);
            clickTimeout.current = null;
          }
          
          const nodeElement = d3.select(`[data-node-id="${nodeIndex}"]`);
          const shouldShowDetails = !isFrozen || nodeElement.classed('node-highlighted');
          
          if (shouldShowDetails) {
            if (isFrozen && frozenHighlight) {
              // Show only the intersection of node systems with frozen systems
              const frozenSystemIds = frozenHighlight.map(s => s.name || JSON.stringify(s));
              const intersectionSystems = node.systems.filter(nodeSystem => 
                frozenSystemIds.includes(nodeSystem.name || JSON.stringify(nodeSystem))
              );
              showNodeDetails({ ...node, systems: intersectionSystems });
            } else {
              showNodeDetails(node);
            }
          }
        })

      // Add node labels with proper positioning
      nodeElement.append('text')
        .attr('class', 'node-text')
        .attr('x', node.x + node.width + 5)
        .attr('y', node.y + node.height / 2)
        .attr('dy', '0.35em')
        .style('font-size', '10px')
        .style('pointer-events', 'none')
        .text(node.name.length > 25 ? node.name.substring(0, 25) + '...' : node.name);
    });

    // Add zoom controls
    const zoomControls = svg.append('g')
      .attr('class', 'zoom-controls')
      .attr('transform', `translate(${width}, 0)`);

    // Zoom in button
    zoomControls.append('rect')
      .classed('zoom-button', true)
      .on('click', function() {
        svg.transition().duration(200).call(
          zoom.translateBy, 0, 0
        ).transition().duration(200).call(
          zoom.scaleBy, 1.2
        );
      });

    zoomControls.append('text')
      .classed('zoom-button-text', true)
      .attr('y', 17)
      .text('+');

    // Zoom out button
    zoomControls.append('rect')
      .classed('zoom-button', true)
      .attr('y', 30)
      .on('click', function() {
        svg.transition().duration(200).call(
          zoom.translateBy, 0, 0
        ).transition().duration(200).call(
          zoom.scaleBy, 0.8
        );
      });

    zoomControls.append('text')
      .classed('zoom-button-text', true)
      .attr('y', 47)
      .text('−');

    // Reset zoom button
    zoomControls.append('rect')
      .classed('zoom-button', true)
      .classed('zoom-button-reset', true)
      .attr('y', 60)
      .on('click', function() {
        svg.transition().duration(200).call(zoom.transform, defaultTransform);
      });

    zoomControls.append('text')
      .classed('zoom-button-text', true)
      .attr('y', 77)
      .text('⌂');

  }, [filteredData, visibleColumns, createSankeyData, showLinkDetails, showNodeDetails, loading, error, allColumns, columnLabels, handleColumnReorder, highlightCompleteFlows, resetHighlighting, freezeHighlight, isFrozen, frozenHighlight]);

  // Effects - Only load data once on mount
  useEffect(() => {
    loadFromAirtable();
  }, []);

  useEffect(() => {
    const filtered = data.filter(d => {
      return activeFilters.every(filter => {
        const fieldValue = d[filter.column];
        if (Array.isArray(fieldValue)) {
          return fieldValue.includes(filter.value);
        }
        return fieldValue === filter.value;
      });
    });
    setFilteredData(filtered);
  }, [data, activeFilters]);

  useEffect(() => {
    if (activeFilters.length > 0 && currentGraph.current) {
      const matchingSystemIds = filteredData.map(s => s.name || JSON.stringify(s));
      
      if (matchingSystemIds.length > 0) {
        if (isFrozen) {
          // Apply as additional highlight on top of frozen
          highlightCompleteFlows(filteredData, false, true);
        } else {
          // Apply as main highlight
          highlightCompleteFlows(filteredData, false, false);
        }
      } else {
        resetHighlighting(true); // Keep frozen if exists
      }
    } else {
      resetHighlighting(true); // Keep frozen if exists
    }
  }, [filteredData, activeFilters, isFrozen]);

  useEffect(() => {
    drawSankey();
  }, [drawSankey]);

  // Responsive resize handler
  useEffect(() => {
    const handleResize = () => {
      drawSankey();
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [drawSankey]);

  // Utility Functions
  const resetView = () => {
    setActiveFilters([]);
    setVisibleColumns([...allColumns]);
  };

  const exportData = () => {
    const exportObject = {
      data: data,
      visibleColumns: visibleColumns,
      timestamp: new Date().toISOString()
    };
    
    const dataStr = JSON.stringify(exportObject, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = 'bio-digital-systems.json';
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const refreshData = () => {
    loadFromAirtable();
  };

  // Computed Values with proper ordering
  const getOrderedValues = (data, field, column) => {
    let uniqueValues = [...new Set(data.flatMap(d => d[field] || []))];
    
    if (column === 'temporality') {
      const timeUnits = ['second', 'minute', 'hour', 'day', 'week'];
      
      uniqueValues.sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        
        const aUnitIndex = timeUnits.findIndex(unit => aLower.includes(unit));
        const bUnitIndex = timeUnits.findIndex(unit => bLower.includes(unit));
        
        if (aUnitIndex === bUnitIndex && aUnitIndex !== -1) {
          const aHasLessOrEqual = aLower.includes('<') || aLower.includes('≤');
          const bHasLessOrEqual = bLower.includes('<') || bLower.includes('≤');
          const aHasGreater = aLower.includes('>') && !aHasLessOrEqual;
          const bHasGreater = bLower.includes('>') && !bHasLessOrEqual;
          
          if (aHasLessOrEqual && bHasGreater) return -1;
          if (bHasLessOrEqual && aHasGreater) return 1;
          
          return a.localeCompare(b);
        }
        
        if (aUnitIndex === bUnitIndex) {
          return a.localeCompare(b);
        }
        
        if (aUnitIndex === -1) return 1;
        if (bUnitIndex === -1) return -1;
        
        return aUnitIndex - bUnitIndex;
      });
    } else if (column === 'scale') {
      const scaleUnits = ['cell', 'organism', 'population', 'ecosystem'];
      
      uniqueValues.sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        
        const aUnitIndex = scaleUnits.findIndex(unit => aLower.includes(unit));
        const bUnitIndex = scaleUnits.findIndex(unit => bLower.includes(unit));
        
        if (aUnitIndex === bUnitIndex) {
          return a.localeCompare(b);
        }
        
        if (aUnitIndex === -1) return 1;
        if (bUnitIndex === -1) return -1;
        
        return aUnitIndex - bUnitIndex;
      });
    } else {
      uniqueValues.sort();
    }
    
    return uniqueValues;
  };

  const uniqueOrganisms = getOrderedValues(data, 'organism', 'organism');
  const uniqueOutputs = getOrderedValues(data, 'output', 'output');

  // Component render
  return (
    <div className="app-container" ref={containerRef}>
      <h1 className="app-title">Bio-Digital Systems Flow Explorer</h1>
      
      {error && (
        <div className="error-message">
          <p>⚠️ {error}</p>
          <button className="btn" onClick={refreshData}>Retry Connection</button>
        </div>
      )}
      
      {/* Controls */}
      <div className="controls">
        <button className="btn" onClick={() => setShowModal(true)} disabled={loading}>
          Add New System
        </button>
        <button className="btn" onClick={resetView}>
          Reset View
        </button>
        <button className="btn" onClick={exportData}>
          Export Data
        </button>
        <button className="btn" onClick={refreshData}>
          Refresh Data
        </button>
        {isFrozen && (
          <button className="btn btn-unfreeze" onClick={unfreezeHighlight}>
            Unfreeze Highlight
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="filter-section">
        <div className="compact-filter-group" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <label style={{ fontWeight: 'bold' }}>Filter by:</label>
          
          <select 
            value={selectedFilterColumn}
            onChange={(e) => {
              setSelectedFilterColumn(e.target.value);
              setSelectedFilterValue('');
            }}
            style={{ minWidth: '120px' }}
          >
            <option value="">Select Category...</option>
            {visibleColumns.map((column, index) => (
              <option key={column} value={column}>
                {columnLabels[allColumns.indexOf(column)]}
              </option>
            ))}
          </select>

          {selectedFilterColumn && (
            <select 
              value={selectedFilterValue}
              onChange={(e) => setSelectedFilterValue(e.target.value)}
              style={{ minWidth: '150px' }}
            >
              <option value="">Select Value...</option>
              {getAvailableFilterValues().map(value => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          )}

          {selectedFilterColumn && selectedFilterValue && (
            <button type="button" className="btn" onClick={addFilter}>
              Add Filter
            </button>
          )}

          {activeFilters.length > 0 && (
            <button type="button" className="btn" onClick={clearAllFilters}>
              Clear All
            </button>
          )}
        </div>

        {activeFilters.length > 0 && (
          <div className="active-filters">
            <div className="chips-container">
              {activeFilters.map(filter => (
                <div key={filter.id} className="chip">
                  <span>{filter.label}</span>
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={() => removeFilter(filter.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Column Controls */}
        <div className="column-controls">
          <h4>Show/Hide Categories:</h4>
          <div className="column-control-group">
            {allColumns.map((column, index) => (
              <div key={column} className="column-toggle">
                <input 
                  type="checkbox" 
                  checked={visibleColumns.includes(column)}
                  onChange={() => handleColumnToggle(column)}
                />
                <label>{columnLabels[index]}</label>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Diagram */}
      <div className="diagram-container">
        <svg 
          ref={svgRef} 
          className="diagram-svg"
        />
      </div>

      {/* Statistics */}
      <div className="stats">
        {filteredData.length} Total Systems, {uniqueOrganisms.length} Unique Organisms
      </div>

      {/* Add New System Modal */}
      {showModal && (
        <AddSystemForm
          existingData={data}
          onSubmit={async (formData) => {
            const success = await handleAddSystem(formData);
            if (success) {
              alert('System added successfully!');
            } else {
              alert('Failed to add system.');
            }
          }}
          onClose={() => setShowModal(false)}
        />
      )}

      {showDetailModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title">{detailContent.title}</h2>
              <button className="modal-close" onClick={handleModalClose}>
                &times;
              </button>
            </div>
            <div className="modal-body" dangerouslySetInnerHTML={{ __html: detailContent.content }} />
          </div>
        </div>
      )}
    </div>
  );
};

export default BioDigitalSankeyApp;