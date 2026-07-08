import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface SessionRecoveryProvider<T = unknown> {
  key: string;
  capture: () => T | null | undefined;
}

export interface SessionRecoveryDraft<T = unknown> {
  key: string;
  version: number;
  createdAt: number;
  expiresAt: number;
  ownerId?: string;
  data: T;
}

@Injectable({
  providedIn: 'root'
})
export class SessionRecoveryService {
  private readonly storagePrefix = 'coding-box-session-recovery:';
  private readonly defaultTtlMs = 6 * 60 * 60 * 1000;
  private readonly providers = new Map<string, SessionRecoveryProvider>();
  private readonly restoreSubject = new Subject<void>();
  private ownerId?: string;

  readonly restore$ = this.restoreSubject.asObservable();

  setOwnerId(ownerId?: string): void {
    this.ownerId = ownerId || undefined;
  }

  registerProvider(provider: SessionRecoveryProvider): () => void {
    this.providers.set(provider.key, provider);
    return () => {
      if (this.providers.get(provider.key) === provider) {
        this.providers.delete(provider.key);
      }
    };
  }

  captureRegisteredDrafts(): void {
    this.providers.forEach(provider => {
      try {
        const data = provider.capture();
        if (data === null || data === undefined) {
          return;
        }
        this.saveDraft(provider.key, data);
      } catch {
        // Recovery must never prevent the reauthentication flow.
      }
    });
  }

  saveDraft<T>(key: string, data: T, ttlMs = this.defaultTtlMs): void {
    const now = Date.now();
    const draft: SessionRecoveryDraft<T> = {
      key,
      version: 1,
      createdAt: now,
      expiresAt: now + ttlMs,
      ...(this.ownerId ? { ownerId: this.ownerId } : {}),
      data
    };

    try {
      sessionStorage.setItem(this.getStorageKey(key), JSON.stringify(draft));
    } catch {
      // Ignore quota and browser storage errors.
    }
  }

  consumeDraft<T>(key: string): T | null {
    const draft = this.readDraft<T>(key);
    if (!draft) {
      return null;
    }

    this.clearDraft(key);
    return draft.data;
  }

  peekDraft<T>(key: string): T | null {
    return this.readDraft<T>(key)?.data ?? null;
  }

  clearDraft(key: string): void {
    try {
      sessionStorage.removeItem(this.getStorageKey(key));
    } catch {
      // Ignore browser storage errors.
    }
  }

  clearAllDrafts(): void {
    try {
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(this.storagePrefix)) {
          sessionStorage.removeItem(key);
        }
      }
    } catch {
      // Ignore browser storage errors.
    }
  }

  notifyRestoredAuthentication(): void {
    this.restoreSubject.next();
  }

  private readDraft<T>(key: string): SessionRecoveryDraft<T> | null {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(this.getStorageKey(key));
    } catch {
      return null;
    }

    if (!raw) {
      return null;
    }

    try {
      const draft = JSON.parse(raw) as SessionRecoveryDraft<T>;
      if (!draft || draft.key !== key || draft.version !== 1 || draft.expiresAt < Date.now()) {
        this.clearDraft(key);
        return null;
      }
      if (draft.ownerId && !this.ownerId) {
        return null;
      }
      if (draft.ownerId && this.ownerId && draft.ownerId !== this.ownerId) {
        this.clearDraft(key);
        return null;
      }
      return draft;
    } catch {
      this.clearDraft(key);
      return null;
    }
  }

  private getStorageKey(key: string): string {
    return `${this.storagePrefix}${key}`;
  }
}
