import { Component, OnInit } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { MatAnchor } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';

@Component({
  selector: 'coding-box-select-replay',
  templateUrl: './select-replay.component.html',
  styleUrls: ['./select-replay.component.scss'],
  standalone: true,
  imports: [MatAnchor, RouterLink, TranslateModule, MatIcon]
})
export class SelectReplayComponent implements OnInit {
  constructor(public appService:AppService, public backendService:BackendService) { }



  ngOnInit(): void {
  }
}
