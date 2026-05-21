/**
 * DTO for expected combinations of responses to be validated
 */
export class ExpectedCombinationDto {
  /**
   * The name/key of the unit.
   */
  unit_key!: string;

  /**
   * Optional unit alias. Coding-list exports include both unit_key and unit_alias.
   */
  unit_alias?: string;

  /**
   * The login name of the person
   */
  login_name!: string;

  /**
   * The login code of the person
   */
  login_code!: string;

  /**
   * Optional group of the person. Needed to disambiguate replay connectors when present.
   */
  person_group?: string;

  /**
   * The name of the booklet (booklet_id)
   */
  booklet_id!: string;

  /**
   * The ID of the variable
   */
  variable_id!: string;

  /**
   * Optional replay page from the coding list.
   */
  variable_page?: string;

  /**
   * Optional replay anchor from the coding list.
   */
  variable_anchor?: string;
}
