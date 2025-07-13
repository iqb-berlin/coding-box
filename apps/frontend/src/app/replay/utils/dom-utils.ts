/**
 * Utility functions for DOM manipulation in the replay module
 */

/**
 * Searches for div elements with data-element-alias attribute in the player's HTML
 * and returns an object mapping the aliases to their corresponding elements.
 *
 * @param iframe The iframe element containing the player's HTML
 * @returns An object mapping data-element-alias values to their HTML elements
 */
export function findElementsByDataAlias(iframe: HTMLIFrameElement): Record<string, HTMLElement> {
  const result: Record<string, HTMLElement> = {};

  try {
    // Check if the iframe has loaded content
    if (iframe.contentDocument) {
      // Query for all div elements with data-element-alias attribute
      const elements = iframe.contentDocument.querySelectorAll('div[data-element-alias]');

      // Create a mapping of aliases to elements
      elements.forEach((element: Element) => {
        const alias = element.getAttribute('data-element-alias');
        if (alias) {
          result[alias] = element as HTMLElement;
        }
      });
    }
  } catch (error) {
    console.error('Error searching for elements with data-element-alias:', error);
  }

  return result;
}

/**
 * Returns the values of the data-element-alias attributes found in the player's HTML.
 *
 * @param iframe The iframe element containing the player's HTML
 * @returns An array of data-element-alias values
 */
export function getDataElementAliases(iframe: HTMLIFrameElement): string[] {
  try {
    // Check if the iframe has loaded content
    if (iframe.contentDocument) {
      // Query for all div elements with data-element-alias attribute
      const elements = iframe.contentDocument.querySelectorAll('div[data-element-alias]');

      // Extract and return the alias values
      return Array.from(elements)
        .map(element => element.getAttribute('data-element-alias'))
        .filter((alias): alias is string => alias !== null);
    }
  } catch (error) {
    console.error('Error getting data-element-alias values:', error);
  }

  return [];
}

/**
 * Scrolls to a div element with the specified data-element-alias in the player's HTML.
 *
 * @param iframe The iframe element containing the player's HTML
 * @param alias The data-element-alias value of the element to scroll to
 * @param options Optional scroll behavior options
 * @returns True if the element was found and scrolled to, false otherwise
 */
export function scrollToElementByAlias(
  iframe: HTMLIFrameElement,
  alias: string,
  options?: ScrollIntoViewOptions
): boolean {
  try {
    const elements = findElementsByDataAlias(iframe);
    const element = elements[alias];
    if (element) {
      // Use scrollIntoView with smooth behavior by default
      element.scrollIntoView(options || { behavior: 'smooth', block: 'center' });
      return true;
    }
  } catch (error) {
    console.error(`Error scrolling to element with alias "${alias}":`, error);
  }

  return false;
}
