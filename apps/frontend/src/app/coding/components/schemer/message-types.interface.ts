import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import { SchemerConfig } from './schemer-config.interface';

export interface VosReadyNotification {
  type: 'vosReadyNotification';
}

export interface VosStartCommand {
  type: 'vosStartCommand';
  sessionId: string;
  schemerConfig: SchemerConfig;
  codingScheme: string;
  codingSchemeType: string;
  variables?: VariableInfo[];
}

export interface VosSchemeChangedNotification {
  type: 'vosSchemeChangedNotification';
  sessionId: string;
  codingScheme: string;
  codingSchemeType: string;
}

export interface VosGetSchemeRequest {
  type: 'vosGetSchemeRequest';
  sessionId: string;
}

export interface VosReadNotification {
  type: 'vosReadNotification';
  sessionId: string;
  message?: string;
}

export type VosMessage =
  | VosReadyNotification
  | VosStartCommand
  | VosSchemeChangedNotification
  | VosGetSchemeRequest
  | VosReadNotification;
