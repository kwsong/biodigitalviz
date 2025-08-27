import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import AddSystemForm from './modals/AddSystemForm';
import { getAirtableFieldMetadata, generateOptionsFromData, addToAirtable, AIRTABLE_CONFIG } from './airtableMetadata';
import './styles/App.css';
import './styles/Modal.css';

// Configuration constants
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
  // Constants
  const allColumns = useMemo(() => {
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
  const [clickedElement, setClickedElement] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Refs
  const svgRef = useRef();
  const currentGraph = useRef(null);
  const draggedElement = useRef(null);
  const containerRef = useRef();
  const clickTimeout = useRef(null);
  const zoomTransformRef = useRef(d3.zoomIdentity);
  const buttonsDisabledRef = useRef(false);
  const globalMaxSystemCount = useRef(0);

  // Helper Functions
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

  // Updated height calculation function - now uses absolute system counts
  const calculateNodeHeight = (systemCount, globalMaxCount) => {
    const minHeight = 5;   // Minimum height for visibility
    const maxHeight = 50;  // Maximum height for largest nodes
    if (globalMaxCount === 0) return minHeight;
    return minHeight + (systemCount / globalMaxCount) * (maxHeight - minHeight);
  };

  // Function to calculate centered Y position for a node with new height
  const calculateCenteredY = (originalNode, newHeight) => {
    const originalCenterY = originalNode.y + originalNode.height / 2;
    return originalCenterY - newHeight / 2;
  };

  // Unified Highlighting Functions
  const applyFrozenHighlighting = useCallback((targetSystems, clickedElement = null, isLink = false) => {
    const allLinks = d3.selectAll('.link');
    const allNodes = d3.selectAll('.node rect');
    
    // Dim everything first (but don't change stroke widths)
    allLinks.classed('flow-dimmed', true);
    allNodes.classed('node-dimmed', true);
    
    const targetSystemIds = targetSystems.map(s => s.name || JSON.stringify(s));
    const linkGroup = d3.select('.links');
    
    // Create blue overlay links on top of dimmed originals
    currentGraph.current.links.forEach((link, linkIndex) => {
      const matchingSystemsCount = link.systems.filter(linkSystem => 
        targetSystemIds.includes(linkSystem.name || JSON.stringify(linkSystem))
      ).length;
      
      if (matchingSystemsCount > 0) {
        const strokeWidth = Math.max(2, matchingSystemsCount * 2);
        
        linkGroup.append('path')
          .attr('class', 'link-overlay link-overlay-blue')
          .attr('data-original-link', linkIndex)
          .attr('d', createLinkPath(link.source, link.target))
          .style('stroke-width', `${strokeWidth}px`)
      }
    });
    
    // Highlight nodes with proportional heights
    currentGraph.current.nodes.forEach((n, nIndex) => {
      const matchingSystemsCount = n.systems.filter(nodeSystem => 
        targetSystemIds.includes(nodeSystem.name || JSON.stringify(nodeSystem))
      ).length;
      
      if (matchingSystemsCount > 0) {
        const nodeElement = d3.select(`[data-node-id="${nIndex}"]`);
        nodeElement
          .classed('node-dimmed', false)
          .classed('node-highlighted', true);

        // Add blue overlay rectangle with height proportional to matching systems
        const overlayHeight = calculateNodeHeight(matchingSystemsCount, globalMaxSystemCount.current);
        const overlayY = calculateCenteredY(n, overlayHeight);
        
        d3.select('.nodes').append('rect')
          .attr('class', 'node-overlay-blue')
          .attr('data-node-overlay', nIndex)
          .attr('x', n.x)
          .attr('y', overlayY)
          .attr('width', n.width)
          .attr('height', overlayHeight)
          .style('fill', d3.select(`[data-node-id="${nIndex}"]`).attr('fill')) // Keep original color for blue overlay
          .style('pointer-events', 'none');
      }
    });
    
    // Add dotted stroke to the clicked link
    if (clickedElement !== null) {
      if (isLink) {
        d3.select(`[data-original-link="${clickedElement}"].link-overlay-blue`)
          .classed('clicked-element', true);
      } else {
        d3.select(`[data-node-overlay="${clickedElement}"]`)
          .classed('clicked-element', true);
      }
    }
  }, []);

  const applyGreenHighlighting = useCallback((intersectionSystemIds) => {
    // Remove previous green overlays
    d3.selectAll('.link-overlay-green').remove();
    d3.selectAll('.node-overlay-green').remove();
    
    // Add class to indicate green highlighting is active
    d3.select('body').classed('green-highlighting-active', true);
    
    // Dim ALL blue overlay links and blue overlay nodes
    d3.selectAll('.link-overlay-blue').classed('link-overlay-blue-dimmed', true);
    d3.selectAll('.node-overlay-blue').classed('node-overlay-blue-dimmed', true);
    
    const linkGroup = d3.select('.links');
    
    // Create green overlay links
    currentGraph.current.links.forEach((link, linkIndex) => {
      const linkSystemIds = link.systems.map(s => s.name || JSON.stringify(s));
      const linkIntersectionCount = linkSystemIds.filter(id => intersectionSystemIds.includes(id)).length;
      
      if (linkIntersectionCount > 0) {
        const hasBlueOverlay = d3.select(`[data-original-link="${linkIndex}"]`).node();
        
        if (hasBlueOverlay) {
          const greenStrokeWidth = Math.max(2, linkIntersectionCount * 2);
          
          linkGroup.append('path')
            .attr('class', 'link-overlay link-overlay-green')
            .attr('data-original-link', linkIndex)
            .attr('d', createLinkPath(link.source, link.target))
            .style('stroke-width', `${greenStrokeWidth}px`);
        }
      }
    });
    
    // Add green overlay nodes
    currentGraph.current.nodes.forEach((n, nIndex) => {
      const nodeSystemIds = n.systems.map(s => s.name || JSON.stringify(s));
      const nodeIntersectionCount = nodeSystemIds.filter(id => intersectionSystemIds.includes(id)).length;
      
      if (nodeIntersectionCount > 0) {
        const hasBlueOverlay = d3.select(`[data-node-overlay="${nIndex}"]`).node();
        
        if (hasBlueOverlay) {

          d3.select(`.node:nth-child(${nIndex + 1})`).attr('data-has-green-overlay', 'true');
          // Add green overlay rectangle with height proportional to intersection systems
          const greenOverlayHeight = calculateNodeHeight(nodeIntersectionCount, globalMaxSystemCount.current);
          const greenOverlayY = calculateCenteredY(n, greenOverlayHeight);
          
          d3.select('.nodes').append('rect')
            .attr('class', 'node-overlay node-overlay-green')
            .attr('data-node-overlay-green', nIndex)
            .attr('x', n.x)
            .attr('y', greenOverlayY)
            .attr('width', n.width)
            .attr('height', greenOverlayHeight)
            .style('pointer-events', 'none');
        }
      }
    });
  }, []);

  const applyClickedElementStyling = useCallback((elementIndex, isLink) => {
    if (isLink) {
      const blueOverlay = d3.select(`[data-original-link="${elementIndex}"].link-overlay-blue`);
      if (blueOverlay.node()) {
        // Get the actual stroke width of the blue overlay
        const blueStrokeWidth = parseFloat(blueOverlay.style('stroke-width')) || 4;
        const outlineWidth = blueStrokeWidth + 4; // 2px on each side
        
        const linkGroup = d3.select('.links');
        const blueOverlayNode = blueOverlay.node();
        
        linkGroup.insert('path', function() { return blueOverlayNode; })
          .attr('class', 'clicked-link-outline')
          .attr('data-clicked-link', elementIndex)
          .attr('d', createLinkPath(currentGraph.current.links[elementIndex].source, currentGraph.current.links[elementIndex].target))
          .style('stroke-width', `${outlineWidth}px`);
      }
    } else {
      d3.select(`[data-node-id="${elementIndex}"]`)
        .classed('clicked-element', true);
    }
  }, []);

  const unfreezeHighlight = useCallback(() => {
    d3.selectAll('.link-overlay').remove();
    d3.selectAll('.node-overlay').remove(); // Add this line
    d3.selectAll('.clicked-link-indicator').remove();
    d3.selectAll('.clicked-element').classed('clicked-element', false);
    
    const allLinks = d3.selectAll('.link');
    const allNodes = d3.selectAll('.node rect');
    
    allLinks.classed('flow-dimmed', false);
    allNodes
      .classed('node-dimmed', false)
      .classed('node-highlighted', false)
      .classed('node-additional', false)
      .classed('clicked-element', false);
    
    setIsFrozen(false);
    setFrozenHighlight(null);
    setClickedElement(null);
  }, []);

  // Unified Event Handlers
  const createElementHandlers = (element, elementIndex, isLink = false) => {
    const getTooltipContent = () => {
      if (isFrozen && frozenHighlight) {
        const frozenSystemIds = frozenHighlight.map(s => s.name || JSON.stringify(s));
        const elementSystemIds = element.systems.map(s => s.name || JSON.stringify(s));
        const intersectionCount = elementSystemIds.filter(id => frozenSystemIds.includes(id)).length;
        
        if (isLink) {
          return `<strong>(${element.source.category}:${element.source.name}) + (${element.target.category}:${element.target.name})</strong><br/>Frozen subset: ${intersectionCount} systems<br/>Click to unfreeze, double-click to explore subset`;
        } else {
          // Get the proper label for the category using FIELD_MAPPING
          const properLabel = Object.keys(FIELD_MAPPING).find(key => FIELD_MAPPING[key] === element.category) || element.category;
          return `<strong>${properLabel}: ${element.name}</strong><br/>Frozen subset: ${intersectionCount} systems<br/>Click to unfreeze, double-click to explore subset`;
        }
      } else {
        if (isLink) {
          return `<strong>(${element.source.category}:${element.source.name}) + (${element.target.category}:${element.target.name})</strong><br/>Systems: ${element.value}<br/>Click to freeze/unfreeze, double-click to explore connections`;
        } else {
          // Get the proper label for the category using FIELD_MAPPING
          const properLabel = Object.keys(FIELD_MAPPING).find(key => FIELD_MAPPING[key] === element.category) || element.category;
          return `<strong>${properLabel}: ${element.name}</strong><br/>Connected systems: ${element.value}<br/>Click to freeze/unfreeze, double-click to explore`;
        }
      }
    };

    return {
      mouseover: function(event) {
        if (!isFrozen) {
          highlightCompleteFlows(element.systems);
        } else {
          const elementSelector = isLink ? `[data-link-id="${elementIndex}"]` : `[data-node-id="${elementIndex}"]`;
          const elementD3 = d3.select(elementSelector);
          const isHighlighted = isLink ? 
            d3.select(`[data-original-link="${elementIndex}"]`).node() !== null :
            elementD3.classed('node-highlighted');
          
          if (isHighlighted && frozenHighlight) {
            const frozenSystemIds = frozenHighlight.map(s => s.name || JSON.stringify(s));
            const hoveredSystemIds = element.systems.map(s => s.name || JSON.stringify(s));
            const intersectionSystemIds = hoveredSystemIds.filter(id => frozenSystemIds.includes(id));
            
            if (intersectionSystemIds.length > 0) {
              applyGreenHighlighting(intersectionSystemIds);
            }
          }
        }
        
        // Show tooltip
        const shouldShowTooltip = !isFrozen || (isLink ? 
          d3.select(`[data-original-link="${elementIndex}"]`).node() !== null :
          d3.select(`[data-node-id="${elementIndex}"]`).classed('node-highlighted'));
        
        if (shouldShowTooltip) {
          const tooltip = d3.select('.tooltip');
          tooltip
            .style('opacity', 1)
            .html(getTooltipContent())
            .style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY +10) + 'px');
        }
      },

      mouseout: function() {
        if (!isFrozen) {
          resetHighlighting();
        } else {
          d3.selectAll('.link-overlay-green').remove();
          d3.selectAll('.node-overlay-green').remove();
          d3.selectAll('.link-overlay-blue').classed('link-overlay-blue-dimmed', false);
          d3.selectAll('.node-overlay-blue').classed('node-overlay-blue-dimmed', false); // Add this line
          // Remove green highlighting active class
          d3.select('body').classed('green-highlighting-active', false);
        }
        d3.select('.tooltip').style('opacity', 0);
      },

      click: function() {
        if (clickTimeout.current) {
          clearTimeout(clickTimeout.current);
          clickTimeout.current = null;
          return;
        }
        
        clickTimeout.current = setTimeout(() => {
          if (isFrozen) {
            unfreezeHighlight();
          } else {
            // Disable transitions to prevent flash
            d3.select('body').classed('no-flash', true);
            
            // Store node information for restoration
            const elementData = isLink ? {
              index: elementIndex,
              isLink: true
            } : {
              index: elementIndex,
              isLink: false,
              nodeCategory: element.category,
              nodeName: element.name
            };
            
            setFrozenHighlight(element.systems);
            setClickedElement(elementData);
            setIsFrozen(true);
            
            setTimeout(() => {
              applyFrozenHighlighting(element.systems);
              
              // Apply clicked styling using shared function
              applyClickedElementStyling(elementIndex, isLink);
              
              // Re-enable transitions
              setTimeout(() => {
                d3.select('body').classed('no-flash', false);
              }, 100);
            }, 25);
          }
          clickTimeout.current = null;
        }, 200);
      },

      dblclick: function(event) {
        event.stopPropagation();
        
        if (clickTimeout.current) {
          clearTimeout(clickTimeout.current);
          clickTimeout.current = null;
        }
        
        const elementSelector = isLink ? `[data-link-id="${elementIndex}"]` : `[data-node-id="${elementIndex}"]`;
        const shouldShowDetails = !isFrozen || (isLink ?
          d3.select(`[data-original-link="${elementIndex}"]`).node() !== null :
          d3.select(elementSelector).classed('node-highlighted'));
        
        if (shouldShowDetails) {
          if (isFrozen && frozenHighlight) {
            const frozenSystemIds = frozenHighlight.map(s => s.name || JSON.stringify(s));
            const intersectionSystems = element.systems.filter(sys => 
              frozenSystemIds.includes(sys.name || JSON.stringify(sys))
            );
            const modifiedElement = { ...element, systems: intersectionSystems };
            
            if (isLink) {
              showLinkDetails(modifiedElement);
            } else {
              showNodeDetails(modifiedElement);
            }
          } else {
            if (isLink) {
              showLinkDetails(element);
            } else {
              showNodeDetails(element);
            }
          }
        }
      }
    };
  };

  // Data Loading
  const loadFromAirtable = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
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

      const processedData = result.records.map(record => {
        const fields = record.fields;
        const system = { id: record.id };
        
        Object.entries(FIELD_MAPPING).forEach(([airtableField, internalField]) => {
          const value = fields[airtableField];
          
          if (internalField === 'organism') {
            const organismValues = normalizeToArray(value);
            const isGMO = fields[Object.keys(FIELD_MAPPING).find(key => FIELD_MAPPING[key] === 'gmo')];
            system[internalField] = organismValues.map(org => `${org}${isGMO ? ' (gmo)' : ''}`);
          } else if (['trigger', 'output', 'scale', 'temporality', 'temporality2', 'role-organism', 'role-digital'].includes(internalField)) {
            system[internalField] = normalizeToArray(value);
          } else if (['author', 'img_name', 'url'].includes(internalField)) {
            system[internalField] = (value || '').toString().trim();
          } else {
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

  // Other functions (filters, handlers, etc.) remain the same but condensed
  const handleAddSystem = useCallback(async (airtableFormData) => {
    try {
      const success = await addToAirtable(airtableFormData);
      if (success) {
        setShowModal(false);
        await loadFromAirtable();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error in handleAddSystem:', error);
      return false;
    }
  }, [loadFromAirtable]);

  const handleModalClose = useCallback(() => {
    setShowDetailModal(false);
  
    // Restore frozen highlighting if it exists
    if (isFrozen && frozenHighlight && clickedElement) {
      setTimeout(() => {
        applyFrozenHighlighting(frozenHighlight);
        
        // Reapply clicked element styling using shared function
        applyClickedElementStyling(clickedElement.index, clickedElement.isLink);
      }, 100);
    }
  }, [isFrozen, frozenHighlight, clickedElement, applyClickedElementStyling]);

  // Highlighting functions
  const highlightCompleteFlows = useCallback((targetSystems, isFrozenHighlight = false, isAdditionalHighlight = false) => {
    if (!currentGraph.current) return;
    
    const allLinks = d3.selectAll('.link');
    const allNodes = d3.selectAll('.node rect');
    const targetSystemIds = targetSystems.map(s => s.name || JSON.stringify(s));
    
    if (!isFrozen) {
      // Dim everything but don't change stroke widths
      allLinks.classed('flow-dimmed', true);
      allNodes.classed('node-dimmed', true);
      
      const linkGroup = d3.select('.links');
      
      // Create blue overlay links on top of dimmed originals
      currentGraph.current.links.forEach((link, linkIndex) => {
        const matchingSystemsCount = link.systems.filter(linkSystem => 
          targetSystemIds.includes(linkSystem.name || JSON.stringify(linkSystem))
        ).length;
        
        if (matchingSystemsCount > 0) {
          const strokeWidth = Math.max(2, matchingSystemsCount * 2);
          
          linkGroup.append('path')
            .attr('class', 'link-overlay link-overlay-blue temporary-highlight')
            .attr('data-original-link', linkIndex)
            .attr('d', createLinkPath(link.source, link.target))
            .style('stroke-width', `${strokeWidth}px`);
        }
      });
      
      // Highlight nodes with proportional overlay rectangles
      currentGraph.current.nodes.forEach((node, nodeIndex) => {
        const matchingSystemsCount = node.systems.filter(nodeSystem => 
          targetSystemIds.includes(nodeSystem.name || JSON.stringify(nodeSystem))
        ).length;
        
        if (matchingSystemsCount > 0) {
          const nodeElement = d3.select(`[data-node-id="${nodeIndex}"]`);
          nodeElement.classed('node-dimmed', false).classed('node-highlighted', true);

          // Add blue overlay rectangle with height proportional to matching systems
          const overlayHeight = calculateNodeHeight(matchingSystemsCount, globalMaxSystemCount.current);
          const overlayY = calculateCenteredY(node, overlayHeight);
          
          d3.select('.nodes').append('rect')
            .attr('class', 'node-overlay node-overlay-blue temporary-highlight')
            .attr('data-node-overlay', nodeIndex)
            .attr('x', node.x)
            .attr('y', overlayY)
            .attr('width', node.width)
            .attr('height', overlayHeight)
            .style('fill', nodeElement.attr('fill')) // Keep original color for blue overlay
            .style('pointer-events', 'none');
        }
      });
    }
  }, [isFrozen]);

  const resetHighlighting = useCallback((keepFrozen = false) => {
    if (!currentGraph.current) return;
    
    const allLinks = d3.selectAll('.link');
    const allNodes = d3.selectAll('.node rect');
    
    if (keepFrozen && isFrozen) {
      allLinks.classed('flow-additional', false);
      allNodes.classed('node-additional', false);
    } else {
      // Remove temporary highlight overlays (both links and nodes)
      d3.selectAll('.temporary-highlight').remove();
      
      allLinks.classed('flow-dimmed', false);
      allNodes
        .classed('node-dimmed', false)
        .classed('node-highlighted', false)
        .classed('node-additional', false);
      
      setIsFrozen(false);
      setFrozenHighlight(null);
    }
  }, [isFrozen]);

  // Sankey data creation
  const createSankeyData = useCallback((systems) => {
    const nodes = [];
    const links = [];
    const nodeMap = new Map();

    visibleColumns.forEach((column) => {
      let uniqueValues = [...new Set(
        systems.flatMap(d => normalizeToArray(d[column])).filter(Boolean)
      )];

      // Sorting logic for different columns
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
          
          if (aUnitIndex === bUnitIndex) return a.localeCompare(b);
          if (aUnitIndex === -1) return 1;
          if (bUnitIndex === -1) return -1;
          return aUnitIndex - bUnitIndex;
        });
      } else if (column === 'scale') {
        const scaleUnits = ['subcell', 'cell', 'organism', 'population', 'ecosystem'];
        uniqueValues.sort((a, b) => {
          const aLower = a.toLowerCase();
          const bLower = b.toLowerCase();
          const aUnitIndex = scaleUnits.findIndex(unit => aLower.includes(unit));
          const bUnitIndex = scaleUnits.findIndex(unit => bLower.includes(unit));
          
          if (aUnitIndex === bUnitIndex) return a.localeCompare(b);
          if (aUnitIndex === -1) return 1;
          if (bUnitIndex === -1) return -1;
          return aUnitIndex - bUnitIndex;
        });
      } else if (column === 'role-organism' || column === 'role-digital') {
        uniqueValues.sort((a, b) => {
          const aLower = a.toLowerCase();
          const bLower = b.toLowerCase();
          
          const getOrder = (value) => {
            if (value.startsWith('input')) return 0;
            if (value.startsWith('output')) return 2;
            if (value.startsWith('power')) return 3;
            if (value === 'none') return 4;
            return 1;
          };
          
          const aOrder = getOrder(aLower);
          const bOrder = getOrder(bLower);
          
          if (aOrder === bOrder) return a.localeCompare(b);
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

    // Create links that can span empty columns
    systems.forEach(system => {
      for (let i = 0; i < visibleColumns.length; i++) {
        const colA = visibleColumns[i];
        const valuesA = normalizeToArray(system[colA]);
        
        if (valuesA.length === 0) continue; // Skip if this column has no data for this system
        
        // Find the next column that has data for this system
        for (let j = i + 1; j < visibleColumns.length; j++) {
          const colB = visibleColumns[j];
          const valuesB = normalizeToArray(system[colB]);
          
          if (valuesB.length === 0) continue; // Skip empty columns
          
          // Found the next column with data - create links
          valuesA.forEach(sourceValue => {
            valuesB.forEach(targetValue => {
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
                }
              }
            });
          });
          
          break; // Stop after finding the first column with data
        }
      }
    });

    return { nodes, links };
  }, [visibleColumns, normalizeToArray]);

  // System details generation
  const generateSystemDetailsHTML = useCallback((systems) => {
    let content = `<p><strong>Related Systems (${systems.length}):</strong></p>`;
    
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
            <div><p>${imgTag}</p></div>
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

  // Event Handlers for showing details
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
      
      newColumns.splice(draggedIndex, 1);
      newColumns.splice(targetIndex, 0, draggedColumn);
      
      setVisibleColumns(newColumns);
    }
  }, [visibleColumns]);

  // Filter functions
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

  // Main drawing function
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

    // Calculate dimensions
    const headerHeight = 80;
    const controlsHeight = 60;
    const filtersHeight = 60;
    const statsHeight = 40;
    const padding = 40;
    const availableHeight = window.innerHeight - headerHeight - controlsHeight - filtersHeight - statsHeight - padding;
    
    const containerWidth = containerRef.current ? containerRef.current.clientWidth - 40 : 1200;
    const width = Math.max(800, containerWidth);
    const height = Math.max(500, availableHeight);
    const margin = { top: 60, right: 80, bottom: 0, left: 100 };

    svg.attr('width', width).attr('height', height);

    // Background click handler
    svg.on('click', function(event) {
      if (event.target === svg.node() && isFrozen) {
        unfreezeHighlight();
      }
    });

    const mainGroup = svg.append('g').attr('class', 'main-group');

    // Simple debounce for zoom buttons
    let lastZoomTime = 0;
    const ZOOM_DEBOUNCE_MS = 400; // Prevent fast zoom clicks

    // Zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.5, 3])
      .on('zoom', function(event) {
        zoomTransformRef.current = event.transform;
        mainGroup.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Apply the current transform (or default if it's the first time)
    const currentTransform = zoomTransformRef.current;
    if (currentTransform.k === 1 && currentTransform.x === 0 && currentTransform.y === 0) {
      // First time - set default position
      const defaultTransform = d3.zoomIdentity.translate(-75, -25).scale(1);
      zoomTransformRef.current = defaultTransform;
      svg.call(zoom.transform, defaultTransform);
    } else {
      // Use saved transform
      svg.call(zoom.transform, currentTransform);
    }

    // create graph
    const graph = createSankeyData(filteredData);
    currentGraph.current = graph;
    
    const nodeWidth = 15;
    const availableWidth = width - margin.left - margin.right;
    const columnWidth = availableWidth / Math.max(1, visibleColumns.length - 1);
    
    // Calculate max value for height scaling
    //const maxNodeValue = Math.max(...graph.nodes.map(n => n.value));
    // Calculate max value for height scaling using ALL data (not just filtered)
    const allSystemCounts = [];
    data.forEach(system => {
      allColumns.forEach(column => {
        const values = normalizeToArray(system[column]);
        values.forEach(value => {
          const nodeId = `${column}-${value}`;
          const existing = allSystemCounts.find(item => item.nodeId === nodeId);
          if (existing) {
            existing.count++;
          } else {
            allSystemCounts.push({ nodeId, count: 1 });
          }
        });
      });
    });

    const globalMaxNodeValue = Math.max(...allSystemCounts.map(item => item.count), 1);
    globalMaxSystemCount.current = globalMaxNodeValue;

    // Then use this for node height calculation:
    visibleColumns.forEach((column, columnIndex) => {
      const nodesInColumn = graph.nodes.filter(n => n.category === column);
      const totalHeight = height - margin.top - margin.bottom;
      const minNodeSpacing = 3;
      
      let totalNodeHeight = 0;
      nodesInColumn.forEach(node => {
        node.height = calculateNodeHeight(node.value, globalMaxNodeValue); // Use global max
        totalNodeHeight += node.height;
      });
      
      // Calculate spacing
      const numNodes = nodesInColumn.length;
      const totalSpacingNeeded = minNodeSpacing * (numNodes - 1);
      const availableSpacing = totalHeight - totalNodeHeight - totalSpacingNeeded;
      
      // If nodes don't fit, scale them down
      if (availableSpacing < 0) {
        const scaleFactor = (totalHeight - totalSpacingNeeded) / totalNodeHeight;
        nodesInColumn.forEach(node => {
          node.height = node.height * scaleFactor;
        });
        totalNodeHeight = totalHeight - totalSpacingNeeded;
      }
      
      // Position nodes with consistent spacing
      let currentY = margin.top;
      const extraSpacing = Math.max(0, availableSpacing) / numNodes;
      
      nodesInColumn.forEach((node, nodeIndex) => {
        node.x = margin.left + (visibleColumns.length === 1 ? 0 : columnIndex * columnWidth);
        node.y = currentY + extraSpacing / 2;
        node.width = nodeWidth;
        currentY += node.height + minNodeSpacing + extraSpacing;
      });
    });

    // Column labels and drag functionality
    const columnLabelsGroup = mainGroup.append('g').attr('class', 'column-labels');

    visibleColumns.forEach((column, columnIndex) => {
      const labelX = margin.left + (visibleColumns.length === 1 ? 0 : columnIndex * columnWidth) + nodeWidth / 2;
      const labelY = margin.top - 20;
      
      const labelGroup = columnLabelsGroup.append('g')
        .attr('class', 'column-label-group')
        .style('cursor', 'move');
      
      labelGroup.append('rect')
        .attr('x', labelX - 50)
        .attr('y', labelY - 15)
        .attr('width', 100)
        .attr('height', 25)
        .attr('fill', 'transparent');
      
      labelGroup.append('text')
        .attr('x', labelX)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .style('font-weight', '800')
        .text(columnLabels[allColumns.indexOf(column)]);
      
      // drag functionality
      labelGroup.call(d3.drag()
        .on('start', function (event) {
          draggedElement.current = column;
          setIsDragging(true);
          d3.select(this).style('opacity', 0.7);
        })
        .on('drag', function(event) {
          const deltaX = event.x - event.subject.x;
          const deltaY = event.y - event.subject.y;
          
          // Move the label group
          d3.select(this).attr('transform', `translate(${deltaX}, ${deltaY})`);
          
          // Move all nodes in this column
          const nodesInColumn = graph.nodes.filter(n => n.category === column);
          nodesInColumn.forEach((node, nodeIndex) => {
            const originalNodeIndex = graph.nodes.indexOf(node);
            
            // Move the node rectangle
            d3.select(`[data-node-id="${originalNodeIndex}"]`)
              .attr('transform', `translate(${deltaX}, ${deltaY})`);
            
            // Move the node text
            d3.select(`.node:nth-child(${originalNodeIndex + 1}) text`)
              .attr('transform', `translate(${deltaX}, ${deltaY})`);
          });
          
          // Update ALL links including overlay links by their data attributes
          graph.links.forEach((link, linkIndex) => {
            if (link.source.category === column || link.target.category === column) {
              // Recalculate link path with temporary node positions
              const sourceX = link.source.category === column ? link.source.x + deltaX : link.source.x;
              const sourceY = link.source.category === column ? link.source.y + deltaY : link.source.y;
              const targetX = link.target.category === column ? link.target.x + deltaX : link.target.x;
              const targetY = link.target.category === column ? link.target.y + deltaY : link.target.y;
              
              const tempSource = { x: sourceX, y: sourceY, width: link.source.width, height: link.source.height };
              const tempTarget = { x: targetX, y: targetY, width: link.target.width, height: link.target.height };
              const newPath = createLinkPath(tempSource, tempTarget);
              
              // Update original link
              d3.select(`[data-link-id="${linkIndex}"]`).attr('d', newPath);
              
              // Update blue overlay link
              d3.select(`[data-original-link="${linkIndex}"].link-overlay-blue`).attr('d', newPath);
              
              // Update green overlay link
              d3.select(`[data-original-link="${linkIndex}"].link-overlay-green`).attr('d', newPath);
              
              // Update clicked link outline
              d3.select(`[data-clicked-link="${linkIndex}"]`).attr('d', newPath);
            }
          });
        })
        .on('end', function (event) {
          d3.select(this).style('opacity', 1);
          d3.select(this).attr('transform', null);
          
          // Reset all node and text transforms
          d3.selectAll('.node rect').attr('transform', null);
          d3.selectAll('.node text').attr('transform', null);
          
          // Determine target column based on final position
          const finalX = labelX + event.x - event.subject.x;
          let targetColumnIndex = Math.round((finalX - margin.left) / columnWidth);
          targetColumnIndex = Math.max(0, Math.min(visibleColumns.length - 1, targetColumnIndex));
          
          const targetColumn = visibleColumns[targetColumnIndex];
          
          // Store frozen state before any changes
          const wasFrozen = isFrozen;
          const frozenSystems = frozenHighlight;
          const clickedElementData = clickedElement;
          
          // Only reorder if we're dropping on a different column
          if (targetColumn && targetColumn !== column) {
            // If we're reordering columns while frozen, just unfreeze everything
            if (isFrozen) {
              unfreezeHighlight();
            }
            
            handleColumnReorder(column, targetColumn);
          } else {
            // Column didn't move - restore frozen highlighting if it was active
            if (wasFrozen && frozenSystems) {
              setTimeout(() => {
                // The graph structure hasn't changed, so we can reapply highlighting
                if (currentGraph.current) {
                  applyFrozenHighlighting(frozenSystems);
                  
                  // For clicked element, restore styling
                  if (clickedElementData && !clickedElementData.isLink) {
                    // Since column order didn't change, the node index should still be valid
                    applyClickedElementStyling(clickedElementData.index, false);
                  } else if (clickedElementData && clickedElementData.isLink) {
                    // For links, also restore if the index is still valid
                    applyClickedElementStyling(clickedElementData.index, true);
                  }
                }
              }, 50);
            }
          }
          
          setIsDragging(false);
          draggedElement.current = null;
        })
      );
    });

    // Vertical line before role-digital column
    const roleDigitalIndex = visibleColumns.indexOf('role-digital');
    if (roleDigitalIndex > 0) {
      const lineX = margin.left + (roleDigitalIndex - 0.4) * columnWidth;
      mainGroup.append('line')
        .attr('x1', lineX).attr('x2', lineX)
        .attr('y1', margin.top).attr('y2', height - margin.bottom)
        .attr('stroke', '#666666').attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,4').style('opacity', 0.7);
    }

    const colorScale = d3.scaleOrdinal().domain(visibleColumns).range(['#bbbbbb']);

    // Tooltip
    const tooltip = d3.select('body')
      .selectAll('.tooltip')
      .data([0])
      .join('div')
      .attr('class', 'tooltip');

    // Draw links
    const linkGroup = mainGroup.append('g').attr('class', 'links');
    
    graph.links.forEach((link, linkIndex) => {
      const handlers = createElementHandlers(link, linkIndex, true);
      
      linkGroup.append('path')
        .attr('class', 'link')
        .attr('data-link-id', linkIndex)
        .attr('d', createLinkPath(link.source, link.target))
        .attr('stroke', colorScale(link.source.category))
        .style('stroke-width', Math.max(2, link.value * 2) + 'px')
        .on('mouseover', handlers.mouseover)
        .on('mouseout', handlers.mouseout)
        .on('click', handlers.click)
        .on('dblclick', handlers.dblclick);
    });

    // Draw nodes
    const nodeGroup = mainGroup.append('g').attr('class', 'nodes');
    
    graph.nodes.forEach((node, nodeIndex) => {
      if (visibleColumns.indexOf(node.category) === -1) return;
      
      const nodeElement = nodeGroup.append('g').attr('class', 'node');
      const handlers = createElementHandlers(node, nodeIndex, false);

      nodeElement.append('rect')
        .attr('data-node-id', nodeIndex)
        .attr('x', node.x).attr('y', node.y)
        .attr('width', node.width).attr('height', node.height)
        .attr('fill', colorScale(node.category))
        .style('cursor', 'pointer')
        .on('mouseover', handlers.mouseover)
        .on('mouseout', handlers.mouseout)
        .on('click', handlers.click)
        .on('dblclick', handlers.dblclick);

      nodeElement.append('text')
        .attr('class', 'node-text')
        .attr('x', node.x + node.width + 5)
        .attr('y', node.y + node.height / 2)
        .attr('dy', '0.35em')
        .style('font-size', '10px')
        .style('pointer-events', 'none')
        .text(node.name.length > 25 ? node.name.substring(0, 25) + '...' : node.name);
    });

    // Zoom controls
    const zoomControls = svg.append('g')
      .attr('class', 'zoom-controls')
      .attr('transform', `translate(${width}, 0)`);

    // Add disabled state tracking
    let buttonsDisabled = false;

    // Zoom buttons with debounce and visual feedback
    [
      { 
        y: 0, 
        text: '+', 
        action: () => {
          if (buttonsDisabledRef.current) return;
          
          // Disable all buttons functionally and visually FIRST
          buttonsDisabledRef.current = true;
          zoomControls.selectAll('.zoom-button').classed('zoom-button-disabled', true);
          zoomControls.selectAll('.zoom-button-text').classed('zoom-button-text-disabled', true);
          
          svg.transition().duration(400).call(zoom.scaleBy, 1.2);
          
          // Re-enable buttons after debounce time
          setTimeout(() => {
            buttonsDisabledRef.current = false;
            zoomControls.selectAll('.zoom-button').classed('zoom-button-disabled', false);
            zoomControls.selectAll('.zoom-button-text').classed('zoom-button-text-disabled', false);
          }, ZOOM_DEBOUNCE_MS);
        }
      },
      { 
        y: 30, 
        text: '−', 
        action: () => {
          if (buttonsDisabledRef.current) return;
          
          // Disable all buttons functionally and visually FIRST
          buttonsDisabledRef.current = true;
          zoomControls.selectAll('.zoom-button').classed('zoom-button-disabled', true);
          zoomControls.selectAll('.zoom-button-text').classed('zoom-button-text-disabled', true);
          
          svg.transition().duration(400).call(zoom.scaleBy, 0.8);
          
          // Re-enable buttons after debounce time
          setTimeout(() => {
            buttonsDisabledRef.current = false;
            zoomControls.selectAll('.zoom-button').classed('zoom-button-disabled', false);
            zoomControls.selectAll('.zoom-button-text').classed('zoom-button-text-disabled', false);
          }, ZOOM_DEBOUNCE_MS);
        }
      },
      {
        y: 60, 
        text: '⌂', 
        action: () => {
          if (buttonsDisabledRef.current) return;
          
          // Disable all buttons functionally and visually FIRST
          buttonsDisabledRef.current = true;
          zoomControls.selectAll('.zoom-button').classed('zoom-button-disabled', true);
          zoomControls.selectAll('.zoom-button-text').classed('zoom-button-text-disabled', true);
          
          const defaultTransform = d3.zoomIdentity.translate(-75, -25).scale(1);
          zoomTransformRef.current = defaultTransform;
          svg.transition().duration(400).call(zoom.transform, defaultTransform);
          
          // Re-enable buttons after debounce time
          setTimeout(() => {
            buttonsDisabledRef.current = false;
            zoomControls.selectAll('.zoom-button').classed('zoom-button-disabled', false);
            zoomControls.selectAll('.zoom-button-text').classed('zoom-button-text-disabled', false);
          }, ZOOM_DEBOUNCE_MS);
        },
        class: 'zoom-button-reset'
      }
    ].forEach(({ y, text, action, class: btnClass }) => {
      zoomControls.append('rect')
        .classed('zoom-button', true)
        .classed(btnClass || '', Boolean(btnClass))
        .attr('y', y)
        .on('click', action);

      zoomControls.append('text')
        .classed('zoom-button-text', true)
        .attr('y', y + 17)
        .text(text);
    });

  }, [filteredData, visibleColumns, createSankeyData, loading, error, allColumns, columnLabels, createElementHandlers]);

  // Effects
  useEffect(() => {
    loadFromAirtable();
  }, [loadFromAirtable]);

  useEffect(() => {
    const filtered = data.filter(d => {
      return activeFilters.every(filter => {
        const fieldValue = d[filter.column];
        return Array.isArray(fieldValue) ? fieldValue.includes(filter.value) : fieldValue === filter.value;
      });
    });
    setFilteredData(filtered);
  }, [data, activeFilters]);

  useEffect(() => {
    console.log('Effect 1: filteredData/activeFilters/isFrozen changed');
    if (activeFilters.length > 0 && currentGraph.current) {
      if (isFrozen) {
        highlightCompleteFlows(filteredData, false, true);
      } else {
        highlightCompleteFlows(filteredData, false, false);
      }
    } else {
      resetHighlighting(true);
    }
  }, [filteredData, activeFilters, isFrozen, highlightCompleteFlows, resetHighlighting]);

  useEffect(() => {
    console.log('Effect 2: drawSankey dependency changed');
    if (!isDragging) {
      drawSankey();
    }
  }, [drawSankey, isDragging]);

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
    
    // Reset zoom
    const defaultTransform = d3.zoomIdentity.translate(-75, -25).scale(1);
    zoomTransformRef.current = defaultTransform;
    
    // Apply to current SVG if it exists
    const svg = d3.select(svgRef.current);
    if (svg.node()) {
      const zoom = d3.zoom().scaleExtent([0.5, 3]);
      svg.call(zoom.transform, defaultTransform);
    }
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
        
        if (aUnitIndex === bUnitIndex) return a.localeCompare(b);
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
        
        if (aUnitIndex === bUnitIndex) return a.localeCompare(b);
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
        <div style={{ cursor: isSubmitting ? 'wait' : 'default' }}>
          <AddSystemForm
            existingData={data}
            onSubmit={async (formData) => {
              if (isSubmitting) return;
              
              setIsSubmitting(true);
              document.body.style.cursor = 'wait';
              
              try {
                const success = await handleAddSystem(formData);
                if (success) {
                  alert('System added successfully!');
                } else {
                  alert('Failed to add system.');
                }
              } finally {
                setIsSubmitting(false);
                document.body.style.cursor = 'default';
              }
            }}
            onClose={() => {
              if (!isSubmitting) {
                setShowModal(false);
              }
            }}
          />
        </div>
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