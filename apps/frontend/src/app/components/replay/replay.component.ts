import { Component, OnInit } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ReactiveFormsModule } from '@angular/forms';
import { NgIf } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { UnitPlayerComponent } from '../unit-player/unit-player.component';
import { BackendService } from '../../services/backend.service';

@Component({
  selector: 'coding-box-replay',
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule, ReactiveFormsModule, NgIf, TranslateModule, UnitPlayerComponent],
  templateUrl: './replay.component.html',
  styleUrl: './replay.component.scss'
})
export class ReplayComponent implements OnInit {
  player :string = '';
  unitDef :string = '';
  constructor(private backendService:BackendService) {}
  ngOnInit(): void {
    this.backendService.getTestFiles(2).subscribe(files => {
      const foundPlayer = files.filter((file: any) => file.filename === 'iqb-player-aspect-2.4.1.html');
      this.player = foundPlayer[0].data;
      const foundUnitDef = files.filter((file: any) => file.filename === 'my-def.voud');
      this.unitDef = foundUnitDef[0].data;
    });
    this.backendService.getResponses(2, 'sdd8c8xf3ucx').subscribe(response => {
      console.log('response: ', response);
    });
  }
}
