import { PostMessage } from './post-message.service';

export interface NavigationMessage extends PostMessage {
  type: 'navigation';
  data: {
    route: string;
    queryParams?: Record<string, string>;
    replaceUrl?: boolean;
  };
}

export interface DataTransferMessage extends PostMessage {
  type: 'dataTransfer';
  data: {
    key: string;
    value: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
}

export interface AuthenticationMessage extends PostMessage {
  type: 'authentication';
  data: {
    event: 'login' | 'logout' | 'sessionExpired' | 'tokenRefresh';
    user?: {
      id: string;
      username: string;
      roles?: string[];
    };
    token?: {
      value: string;
      expiresAt: number;
    };
  };
}

export interface UiEventMessage extends PostMessage {
  type: 'uiEvent';
  data: {
    event: 'modalOpen' | 'modalClose' | 'notification' | 'themeChange' | 'resize';
    payload?: Record<string, unknown>;
  };
}

export interface ErrorMessage extends PostMessage {
  type: 'error';
  data: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    stack?: string;
  };
}

export interface IframeMessage extends PostMessage {
  type: 'iframe';
  data: {
    action: 'load' | 'unload' | 'resize' | 'refresh' | 'getData' | 'setData';
    targetId?: string;
    payload?: Record<string, unknown>;
  };
}

export interface SchemerMessage extends PostMessage {
  type: 'vosReadyNotification' | 'vosStartCommand' | 'vosSchemeChangedNotification' | 'vosReadNotification' | 'vosGetSchemeRequest';
  sessionId: string;
  codingScheme?: string;
  codingSchemeType?: string;
  schemerConfig?: {
    definitionReportPolicy: 'eager' | 'onDemand';
    role: 'editor' | 'viewer' | 'admin';
  };
  message?: string;
}

export type ApplicationMessage =
  | NavigationMessage
  | DataTransferMessage
  | AuthenticationMessage
  | UiEventMessage
  | ErrorMessage
  | IframeMessage
  | SchemerMessage;
