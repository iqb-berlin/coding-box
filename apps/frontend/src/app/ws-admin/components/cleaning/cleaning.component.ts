import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'coding-box-cleaning',
  templateUrl: './cleaning.component.html',
  styleUrls: ['./cleaning.component.scss'],
  standalone: true,
  imports: [
    TranslateModule,
    MatCardModule,
    MatButtonModule
  ]
})
export class CleaningComponent {
  // This component will be responsible for cleaning of the data
  // after automatic and manual coding in the future
}
