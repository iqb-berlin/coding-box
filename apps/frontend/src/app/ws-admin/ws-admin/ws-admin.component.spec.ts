import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientModule } from '@angular/common/http';
import { TranslateModule } from '@ngx-translate/core';
import { MatTabsModule } from '@angular/material/tabs';
import { WsAdminComponent } from './ws-admin.component';
import { ActivatedRoute } from '@angular/router';

describe('WsAdminComponent', () => {
  let component: WsAdminComponent;
  let fixture: ComponentFixture<WsAdminComponent>;
  const fakeActivatedRoute = {
    snapshot: { params: ['ws'] }
  } ;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: fakeActivatedRoute
        }],
      imports: [
        MatTabsModule,
        HttpClientModule,
        TranslateModule.forRoot()
      ]
    })
      .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(WsAdminComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
