import {
  ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal, viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule, NgForm } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDialog } from '@angular/material/dialog';
import { MatInputModule } from '@angular/material/input';
import { finalize } from 'rxjs';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';
import { testcenterSettingsErrorKey } from './testcenter-settings-errors';
import { TestcenterInstancesService } from '../../../core/services/testcenter-instances.service';
import { TestcenterInstanceDto } from '../../../../../../../api-dto/testcenter/testcenter-instance.dto';

@Component({
  selector: 'coding-box-testcenter-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule],
  templateUrl: './testcenter-settings.component.html',
  styleUrls: ['./testcenter-settings.component.scss']
})
export class TestcenterSettingsComponent implements OnInit {
  private readonly dialog = inject(MatDialog);
  private readonly service = inject(TestcenterInstancesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);
  private readonly instanceForm = viewChild<NgForm>('instanceForm');
  protected readonly instances = signal<TestcenterInstanceDto[]>([]);
  protected readonly displayedInstances = computed(() => [...this.instances()].sort((a, b) => (
    Number(a.source !== 'administrator') - Number(b.source !== 'administrator')
  )));

  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly name = signal('');
  protected readonly baseUrl = signal('');
  protected readonly editingUrl = signal<string | null>(null);
  protected readonly testingUrl = signal('');
  protected readonly checks = signal<Record<string, string>>({});
  protected readonly operationPending = computed(() => this.loading() || this.busy() || !!this.testingUrl());
  protected readonly sourceLabels = {
    standard: 'ui-text.testcenter-instances.source.standard',
    environment: 'ui-text.testcenter-instances.source.environment',
    administrator: 'ui-text.testcenter-instances.source.administrator'
  };

  ngOnInit(): void { this.load(); }

  protected isHttpUrl(value: string): boolean {
    return /^http:\/\//i.test(value.trim());
  }

  protected load(): void {
    if (this.operationPending()) return;
    this.loading.set(true);
    this.error.set('');
    this.service.getInstances().pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => this.loading.set(false))
    ).subscribe({
      next: instances => this.instances.set(instances),
      error: error => this.error.set(this.translate.instant(testcenterSettingsErrorKey(error, 'load')))
    });
  }

  protected save(): void {
    if (this.operationPending() || !this.name().trim() || !this.baseUrl().trim()) return;
    this.busy.set(true);
    this.error.set('');
    this.service.saveInstance({ label: this.name().trim(), baseUrl: this.editingUrl() ?? this.baseUrl().trim() }).pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => this.busy.set(false))
    ).subscribe({
      next: instances => {
        this.instances.set(instances);
        this.resetForm();
      },
      error: error => this.error.set(this.translate.instant(testcenterSettingsErrorKey(error, 'save')))
    });
  }

  protected edit(instance: TestcenterInstanceDto): void {
    if (this.operationPending() || instance.source === 'environment') return;
    this.editingUrl.set(instance.baseUrl);
    this.name.set(instance.label);
    this.baseUrl.set(instance.baseUrl);
  }

  protected resetForm(): void {
    this.editingUrl.set(null);
    this.name.set('');
    this.baseUrl.set('');
    this.instanceForm()?.resetForm({ name: '', baseUrl: '' });
  }

  protected remove(instance: TestcenterInstanceDto): void {
    if (this.operationPending() || instance.source === 'environment') return;
    this.busy.set(true);
    this.error.set('');
    this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
      data: {
        title: this.translate.instant('ui-text.testcenter-instances.revoke-title'),
        content: this.translate.instant('ui-text.testcenter-instances.revoke-content', { name: instance.label, url: instance.baseUrl }),
        confirmButtonLabel: this.translate.instant('ui-text.testcenter-instances.revoke'),
        showCancel: true
      }
    }).afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
      if (confirmed !== true) { this.busy.set(false); return; }
      this.revoke(instance);
    });
  }

  private revoke(instance: TestcenterInstanceDto): void {
    this.service.deleteInstance(instance.baseUrl).pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => this.busy.set(false))
    ).subscribe({
      next: instances => {
        this.instances.set(instances);
        this.checks.update(checks => { const next = { ...checks }; delete next[instance.baseUrl]; return next; });
        if (this.editingUrl() === instance.baseUrl) this.resetForm();
      },
      error: error => this.error.set(this.translate.instant(testcenterSettingsErrorKey(error, 'delete')))
    });
  }

  protected test(instance: TestcenterInstanceDto): void {
    if (this.operationPending()) return;
    this.testingUrl.set(instance.baseUrl);
    this.checks.update(checks => ({ ...checks, [instance.baseUrl]: '' }));
    this.service.testConnection(instance.baseUrl).pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => this.testingUrl.set(''))
    ).subscribe({
      next: result => this.checks.update(checks => ({
        ...checks, [instance.baseUrl]: this.translate.instant('ui-text.testcenter-instances.reachable', { version: result.version })
      })),
      error: error => this.checks.update(checks => ({
        ...checks, [instance.baseUrl]: this.translate.instant(testcenterSettingsErrorKey(error, 'connection'))
      }))
    });
  }
}
