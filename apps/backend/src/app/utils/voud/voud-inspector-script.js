#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Simplified version of the extractVariableLocation function for standalone use
function collectIdsWithKeyedPaths(node, path = {}, collected = [], visibility = null, skipCollect = false) {
  if (Array.isArray(node)) {
    node.forEach(child => {
      collectIdsWithKeyedPaths(child, path, collected, visibility, skipCollect);
    });
    return collected;
  }

  if (typeof node === 'object' && node !== null) {
    // If at a 'page' level object, update visibility
    let currentVisibility = visibility;
    if ('alwaysVisible' in node && 'sections' in node) {
      currentVisibility = node.alwaysVisible;
    }

    // Only collect if not under a skipped key
    if ('id' in node && !skipCollect) {
      collected.push({
        id: node.id,
        markingPanels: node.markingPanels,
        connectedTo: node.connectedTo,
        alwaysVisible: currentVisibility,
        path: { ...path }
      });
    }

    // eslint-disable-next-line guard-for-in
    for (const key in node) {
      const value = node[key];
      const shouldSkip = skipCollect || ['value', 'visibilityRules'].includes(key);

      if (Array.isArray(value)) {
        value.forEach((child, index) => {
          const newPath = { ...path, [key]: index };
          collectIdsWithKeyedPaths(child, newPath, collected, currentVisibility, shouldSkip);
        });
      } else if (typeof value === 'object' && value !== null) {
        const newPath = { ...path, [key]: 0 }; // object branch, no index
        collectIdsWithKeyedPaths(value, newPath, collected, currentVisibility, shouldSkip);
      }
    }
  }

  return collected;
}

function findDependencies(data) {
  return data.map((currentObj, _, arr) => {
    const connectedIds = (currentObj.connectedTo || []).concat(currentObj.markingPanels || []);

    const dependencies = connectedIds.flatMap(depId => arr
      .filter(({ id }) => id === depId)
      .map(match => ({
        variable_dependency_ref: match.id,
        variable_dependency_path: match.path,
        variable_dependency_page_always_visible: match.alwaysVisible
      })));

    return {
      variable_ref: currentObj.id,
      variable_path: currentObj.path,
      variable_page_always_visible: currentObj.alwaysVisible,
      variable_dependencies: dependencies
    };
  });
}

function extractVariableLocation(units) {
  return units.map((unit) => {
    let definitionParsed;
    try {
      definitionParsed = JSON.parse(unit.definition);
    } catch (parseError) {
      throw new Error(`Failed to parse unit definition: ${parseError.message}`);
    }

    const data = collectIdsWithKeyedPaths(definitionParsed);
    unit.variable_pages = findDependencies(data);

    delete unit.definition;

    return unit;
  });
}

function inspectVoudFile(filePathOrContent) {
  try {
    let content;

    // Check if it's a file path or content
    if (fs.existsSync(filePathOrContent)) {
      // It's a file path
      console.log(`=== Inspecting VOUD file: ${path.basename(filePathOrContent)} ===`);
      content = fs.readFileSync(filePathOrContent, 'utf8');
    } else {
      // Assume it's the content directly
      console.log('=== Inspecting VOUD content ===');
      content = filePathOrContent;
    }

    // Create the unit object as expected by extractVariableLocation
    const unit = { definition: content };

    // Extract variable locations
    const result = extractVariableLocation([unit]);

    if (result.length === 0 || !result[0].variable_pages || result[0].variable_pages.length === 0) {
      console.log('No variables found in this VOUD file.');
      return;
    }

    console.log(`\nFound ${result[0].variable_pages.length} variables:\n`);
    console.log('────────────────────────────────────────────────────────────────');

    result[0].variable_pages.forEach((variable, index) => {
      console.log(`📍 Variable ${index + 1}: "${variable.variable_ref}"`);
      console.log(`   Path: pages[${variable.variable_path.pages}] → sections[${variable.variable_path.sections}] → elements[${variable.variable_path.elements}]`);
      console.log(`   Always Visible: ${variable.variable_page_always_visible ? '✅ Yes' : '❌ No'}`);

      if (variable.variable_dependencies && variable.variable_dependencies.length > 0) {
        console.log(`   Dependencies (${variable.variable_dependencies.length}):`);
        variable.variable_dependencies.forEach(dep => {
          console.log(`     • "${dep.variable_dependency_ref}"`);
          console.log(`       Path: pages[${dep.variable_dependency_path.pages}] → sections[${dep.variable_dependency_path.sections}] → elements[${dep.variable_dependency_path.elements}]`);
        });
      } else {
        console.log('   Dependencies: None');
      }
      console.log('────────────────────────────────────────────────────────────────');
    });

    console.log('\n🎉 Inspection Complete!\n');

  } catch (error) {
    console.error('❌ Error processing VOUD file:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('🎯 VOUD File Inspector');
  console.log('');
  console.log('Usage:');
  console.log('  node voud-inspector-script.js <file-path>');
  console.log('  node voud-inspector-script.js -c <json-content>');
  console.log('');
  console.log('Examples:');
  console.log('  node voud-inspector-script.js sample.voud');
  console.log('  node voud-inspector-script.js -c \'{"pages":[{"sections":[{"elements":[{"id":"var1"}]}]}]}\'');
  console.log('');
  console.log('This tool analyzes .voud files and shows variable locations, paths, and dependencies.');
  process.exit(1);
}

if (args[0] === '-c' && args.length >= 2) {
  // Content mode
  inspectVoudFile(args.slice(1).join(' '));
} else {
  // File mode
  const filePath = args[0];
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }
  inspectVoudFile(filePath);
}
