/**
 * DTO for expected combinations of responses to be validated
 */
export class ExpectedCombinationDto {
  /**
   * The alias of the unit (unit_key)
   */
  unit_key!: string;

  /**
   * The login name of the person
   */
  login_name!: string;

  /**
   * The login code of the person
   */
  login_code!: string;

  /**
   * The name of the booklet (booklet_id)
   */
  booklet_id!: string;

  /**
   * The ID of the variable
   */
  variable_id!: string;
}
