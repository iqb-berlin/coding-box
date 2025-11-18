import * as fs from 'fs';
import * as path from 'path';
import { extractVariableLocation } from './extractVariableLocation';

function inspectVoudFile(filePathOrContent) {
  try {
    let content;

    // Check if it's a file path or content
    if (fs.existsSync(filePathOrContent)) {
      // It's a file path
      console.log(`=== Inspecting VOUD file: ${filePathOrContent} ===`);
      content = fs.readFileSync(filePathOrContent, 'utf8');
    } else {
      // Assume it's the content directly
      console.log('=== Inspecting VOUD content ===');
      content = filePathOrContent;
    }

    // Parse the JSON
    const unitData = JSON.parse(content);

    // Create the unit object as expected by extractVariableLocation
    const unit = { definition: content };

    // Extract variable locations
    const result = extractVariableLocation([unit]);

    if (result.length === 0 || !result[0].variable_pages || result[0].variable_pages.length === 0) {
      console.log('No variables found in this VOUD file.');
      return;
    }

    console.log(`Found ${result[0].variable_pages.length} variables:\n`);

    result[0].variable_pages.forEach((variable, index) => {
      console.log(`----- Variable ${index + 1}: ${variable.variable_ref} -----`);
      console.log(`  Path: pages[${variable.variable_path.pages}] -> sections[${variable.variable_path.sections}] -> elements[${variable.variable_path.elements}]`);
      console.log(`  Always Visible: ${variable.variable_page_always_visible ?? 'false'}`);

      if (variable.variable_dependencies && variable.variable_dependencies.length > 0) {
        console.log(`  Dependencies:`);
        variable.variable_dependencies.forEach(dep => {
          console.log(`    - ${dep.variable_dependency_ref} (path: pages[${dep.variable_dependency_path.pages}] -> sections[${dep.variable_dependency_path.sections}] -> elements[${dep.variable_dependency_path.elements}])`);
        });
      } else {
        console.log('  Dependencies: none');
      }
      console.log('');
    });

    console.log('=== Inspection Complete ===');

  } catch (error) {
    console.error('Error processing VOUD file:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
  }
}

// Check if called from command line
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node voud-inspector.js <file-path>');
    console.log('Or: node voud-inspector.js -c <json-content>');
    console.log('');
    console.log('Examples:');
    console.log('  node voud-inspector.js sample.voud');
    console.log('  node voud-inspector.js -c \'{"pages":[{"sections":[{"elements":[{"id":"test"}]}]}]}\'');
    process.exit(1);
  }

  if (args[0] === '-c' && args.length >= 2) {
    // Content mode
    inspectVoudFile(args.slice(1).join(' '));
  } else {
    // File mode
    const filePath = args[0];
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    inspectVoudFile(filePath);
  }
}

module.exports = { inspectVoudFile };
