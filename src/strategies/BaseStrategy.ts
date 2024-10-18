export abstract class BaseStrategy {
  protected params: any;

  constructor(params: any) {
    this.params = params;
  }

  abstract execute(): Promise<void>;
}
