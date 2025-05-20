import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatAnchor } from '@angular/material/button';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'coding-box-coding-management',
  templateUrl: './coding-management.component.html',
  styleUrls: ['./coding-management.component.scss'],
  imports: [TranslateModule, MatAnchor, RouterLink]
})
export class CodingManagementComponent {

}
