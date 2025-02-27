import { UserInListDto } from '../../../../../../api-dto/user/user-in-list-dto';

export class WorkspaceUserChecked {
  id: number;
  name: string;
  displayName: string | undefined;
  description: string | undefined;
  accessLevel: number;
  isChecked: boolean;
  constructor(userDto: UserInListDto) {
    this.id = userDto.id;
    this.name = userDto.name;
    this.displayName = userDto.displayName;
    this.description = userDto.description;
    this.accessLevel = userDto.accessLevel;
    this.isChecked = false;
  }
}
