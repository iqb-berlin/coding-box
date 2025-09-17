// common/interfaces/booklet.interface.ts
export interface IBooklet {
  id: number;
  title: string;
  sessions?: ISession[];
}

export interface ISession {
  id: number;
  ts: number;
  booklet?: IBooklet;
}
