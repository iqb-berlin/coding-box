/**
 * Interface representing the configuration options for the unit schemer
 */
export interface SchemerConfig {
  /**
   * The policy for reporting definition changes
   * - 'eager': Report changes immediately
   * - 'onDemand': Report changes only when requested
   */
  definitionReportPolicy: 'eager' | 'onDemand';

  /**
   * The role of the user
   * - 'editor': Can edit the scheme
   * - 'viewer': Can only view the scheme
   * - 'admin': Has full access to the scheme
   */
  role: 'editor' | 'viewer' | 'admin';
}
