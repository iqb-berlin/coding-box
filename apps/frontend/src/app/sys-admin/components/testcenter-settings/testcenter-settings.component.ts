import {
  ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal, viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule, NgForm } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { finalize } from 'rxjs';
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
  protected readonly testingUrl = signal('');
  protected readonly checks = signal<Record<string, string>>({});
  protected readonly sourceLabels = {
    standard: 'ui-text.testcenter-instances.source.standard',
    environment: 'ui-text.testcenter-instances.source.environment',
    administrator: 'ui-text.testcenter-instances.source.administrator'
  };

  ngOnInit(): void { this.load(); }

  protected load(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.service.getInstances().pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => this.loading.set(false))
    ).subscribe({
      next: instances => this.instances.set(instances),
      error: () => this.error.set(this.translate.instant('ui-text.testcenter-instances.load-failed'))
    });
  }

  protected save(): void {
    if (this.busy() || !this.name().trim() || !this.baseUrl().trim()) return;
    this.busy.set(true);
    this.error.set('');
    this.service.saveInstance({ label: this.name().trim(), baseUrl: this.baseUrl().trim() }).pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => this.busy.set(false))
    ).subscribe({
      next: instances => {
        this.instances.set(instances);
        this.name.set('');
        this.baseUrl.set('');
        this.instanceForm()?.resetForm({ name: '', baseUrl: '' });
      },
      error: () => this.error.set(this.translate.instant('ui-text.testcenter-instances.save-failed'))
    });
  }

  protected edit(instance: TestcenterInstanceDto): void {
    this.name.set(instance.label);
    this.baseUrl.set(instance.baseUrl);
  }

  protected remove(instance: TestcenterInstanceDto): void {
    if (this.busy() || instance.source !== 'administrator') return;
    this.busy.set(true);
    this.error.set('');
    this.service.deleteInstance(instance.baseUrl).pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => this.busy.set(false))
    ).subscribe({
      next: instances => this.instances.set(instances),
      error: () => this.error.set(this.translate.instant('ui-text.testcenter-instances.delete-failed'))
    });
  }

  protected test(instance: TestcenterInstanceDto): void {
    if (this.testingUrl()) return;
    this.testingUrl.set(instance.baseUrl);
    this.checks.update(checks => ({ ...checks, [instance.baseUrl]: '' }));
    this.service.testConnection(instance.baseUrl).pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => this.testingUrl.set(''))
    ).subscribe({
      next: result => this.checks.update(checks => ({
        ...checks, [instance.baseUrl]: this.translate.instant('ui-text.testcenter-instances.reachable', { version: result.version })
      })),
      error: () => this.checks.update(checks => ({
        ...checks, [instance.baseUrl]: this.translate.instant('ui-text.testcenter-instances.connection-failed')
      }))
    });
  }
}
