#!/usr/bin/env node

// This is a wrapper script to run the transform.ts file using ts-node
const { execSync } = require('child_process');
const path = require('path');

try {
  // Get the directory of the current script
  const scriptDir = __dirname;

  // Path to the transform.ts file
  const transformPath = path.join(scriptDir, 'transform.ts');

  // Run the transform.ts file using ts-node with the appropriate flags
  const command = `npx ts-node --project ${path.join(scriptDir, '../../../../../../tsconfig.base.json')} -r tsconfig-paths/register ${transformPath}`;

  console.log('Running command:', command);

  // Execute the command with increased buffer size and capture the output
  const output = execSync(command, {
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024 // 100MB buffer
  });

  // Display the output
  console.log(output,'ssss');

} catch (error) {
  console.error('Error running transform.ts:', error.message);
  process.exit(1);
}
