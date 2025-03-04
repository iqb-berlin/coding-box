import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { WsRolesHeaderComponent } from './ws-roles-header.component';

describe('WsRolesHeaderComponent', () => {
  let component: WsRolesHeaderComponent;
  let fixture: ComponentFixture<WsRolesHeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        WsRolesHeaderComponent,
        TranslateModule.forRoot()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WsRolesHeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
