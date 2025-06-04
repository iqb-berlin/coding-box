#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */

// Interfaces for type safety

// Represents the input to the main function
interface RespDefinition {
  definition: string; // Expected to be a JSON string
}

// Represents the parsed structure of `respDefinition.definition`
interface UnitDefinition {
  pages?: PageData[]; // An array of page objects
  [key: string]: any; // Allow other properties
}

// Represents a single page object within UnitDefinition
interface PageData {
  alwaysVisible?: any; // Can be various types before simplification
  id?: any; // Can be various types before simplification
  visibilityRules?: any; // Used as a condition in getDeepestElements
  [key: string]: any; // Allow other properties
}

// Represents the final structure for an item in the output `variablePages` array
interface TransformedVariablePage {
  variable_page_always_visible: string[]; // Array of strings after simplification
  variable_page: number; // 0-indexed, relative page number within its group
  variable_ref: string; // A single variable reference string
}

// Represents the final output structure of the prepareDefinition function
interface PrepareDefinitionOutput {
  unitDefinition: UnitDefinition;
  variablePages: TransformedVariablePage[];
}

/**
 * Recursively finds elements by a given label within a nested object.
 * Mimics R's get_deepest_elements.
 * @param x The object or array to search within.
 * @param label The key/label to search for.
 * @param noParent An array of keys whose children should not be traversed.
 * @returns An array of found elements. This array might contain nested arrays
 *          before being processed by listSimplify.
 */
function getDeepestElements(
  x: any,
  label: string,
  noParent: string[] = []
): any[] {
  if (typeof x !== 'object' || x === null) {
    return [];
  }

  let collectedElements: any[] = [];

  // If the label exists as a direct property of x
  if (Object.prototype.hasOwnProperty.call(x, label)) {
    collectedElements.push(x[label]);
  }

  // Iterate over properties of x for recursive calls
  // If x is an array, iterate over its elements
  if (Array.isArray(x)) {
    for (const item of x) {
      // For arrays, nodeName concept doesn't apply for noParent check here directly,
      // but children are traversed.
      const deeperElements = getDeepestElements(item, label, noParent);
      collectedElements = collectedElements.concat(deeperElements);
    }
  } else { // If x is an object
    for (const nodeName in x) {
      if (Object.prototype.hasOwnProperty.call(x, nodeName)) {
        if (!noParent.includes(nodeName)) {
          const node = x[nodeName];
          const deeperElements = getDeepestElements(node, label, noParent);
          collectedElements = collectedElements.concat(deeperElements);
        }
      }
    }
  }
  return collectedElements;
}

/**
 * Simplifies a potentially nested array into a flat array of strings.
 * Mimics R's purrr::list_simplify behavior for this specific use case.
 * @param arr The array to simplify.
 * @returns A flat array of strings.
 */
function listSimplify(arr: any[]): string[] {
  return arr
    .flat(Infinity) // Flattens to any depth
    .filter(item => typeof item === 'string' || typeof item === 'number') // Keep only strings or numbers
    .map(String); // Convert all to strings
}

/**
 * Processes a response definition to extract and structure variable page information.
 * Mimics the R function prepare_definition.
 * @param respDefinition The response definition object.
 * @returns An object containing the parsed unitDefinition and the transformed variablePages.
 */
function prepareDefinition(respDefinition: RespDefinition): PrepareDefinitionOutput {
  const unitDefinition: UnitDefinition = JSON.parse(respDefinition.definition);

  // Intermediate structure for processing pages
  interface RawVariablePageInfo {
    variable_page: number;
    variable_ref: string[];
    variable_page_always_visible: string[];
  }

  const rawVariablePagesData: RawVariablePageInfo[] = (unitDefinition.pages || []).map((page, i) => {
    const rawAlwaysVisible = getDeepestElements(page, 'alwaysVisible');
    const variable_page_always_visible = listSimplify(rawAlwaysVisible);

    const rawRef = getDeepestElements(page, 'id', ['visibilityRules']);
    const variable_ref = listSimplify(rawRef);

    return {
      variable_page: i, // Use 0-based index from TypeScript's map
      variable_ref,
      variable_page_always_visible
    };
  });

  // Intermediate structure after unnesting variable_ref
  interface UnnestedVariablePageInfo {
    variable_page: number;
    variable_ref_item: string;
    grouping_key_always_visible: string; // For stable grouping
    original_always_visible: string[];
  }

  const unnestedVariablePages: UnnestedVariablePageInfo[] = rawVariablePagesData.flatMap(
    pageData => pageData.variable_ref.map(refItem => ({
      variable_page: pageData.variable_page,
      variable_ref_item: refItem,
      grouping_key_always_visible: JSON.stringify(pageData.variable_page_always_visible.slice().sort()),
      original_always_visible: pageData.variable_page_always_visible
    }))
  );

  // Group by `grouping_key_always_visible`
  const grouped = new Map<string, UnnestedVariablePageInfo[]>();
  unnestedVariablePages.forEach(item => {
    const groupList = grouped.get(item.grouping_key_always_visible);
    if (groupList) {
      groupList.push(item);
    } else {
      grouped.set(item.grouping_key_always_visible, [item]);
    }
  });

  const mutatedVariablePages: TransformedVariablePage[] = [];
  grouped.forEach(groupItems => {
    if (groupItems.length === 0) return;

    // Find the minimum variable_page in the current group
    const minVariablePage = Math.min(...groupItems.map(item => item.variable_page));

    groupItems.forEach(item => {
      mutatedVariablePages.push({
        variable_page_always_visible: item.original_always_visible,
        variable_page: item.variable_page - minVariablePage, // Adjust page number
        variable_ref: item.variable_ref_item
      });
    });
  });

  // The R code wraps `unit_definition` and `variable_pages` in lists within the final tibble.
  // In TypeScript, it's more idiomatic to return the structures directly.
  return {
    unitDefinition,
    variablePages: mutatedVariablePages
  };
}

// Export the prepareDefinition function for use in other modules
module.exports = { prepareDefinition };

// Main execution when run as a script
if (require.main === module) {
  try {
    // Get the directory of the current script
    const scriptDir = __dirname;

    // Read the sample.voud file
    const sampleFilePath = path.join(scriptDir, 'sample.voud');
    const sampleContent = fs.readFileSync(sampleFilePath, 'utf8');

    // Prepare the input for prepareDefinition
    const respDefinition: RespDefinition = {
      definition: sampleContent
    };

    try {
      // Process the definition
      const result = prepareDefinition(respDefinition);

      // Output a success message instead of the full result to avoid buffer overflow
      console.log('Result generated successfully. Size of variablePages array:', result.variablePages.length);

      console.log('Successfully processed sample.voud');
    } catch (parseError) {
      console.error('Error parsing JSON from sample.voud:', parseError);

      // Try to fix common JSON issues and retry
      console.log('Attempting to fix JSON and retry...');

      // Replace control characters that might be causing issues
      const cleanedContent = sampleContent.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

      try {
        const fixedRespDefinition: RespDefinition = {
          definition: cleanedContent
        };

        const result = prepareDefinition(fixedRespDefinition);
        console.log(result);
        console.log('Result generated successfully after fixing JSON. Size of variablePages array:', result.variablePages.length);
        console.log('Successfully processed sample.voud after fixing JSON');
      } catch (retryError) {
        console.error('Failed to process even after fixing JSON:', retryError);
        process.exit(1);
      }
    }
  } catch (error) {
    console.error('Error reading sample.voud file:', error);
    process.exit(1);
  }
}
