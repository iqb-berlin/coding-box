type ItemMatrixAcceptance = {
  matrixValues: Array<'score' | 'code'>;
  total: number;
  groupCount: number;
  zipEntries: string[];
  fileName: string;
};

describe('live incomplete item matrix export', () => {
  before(() => {
    cy.task('replay:setup', null, { log: false });
  });

  after(() => {
    cy.task('replay:cleanup', null, { log: false });
  });

  it('keeps score and code jobs failed and delivers the confirmed diagnostic ZIP', () => {
    cy.task('item-matrix:verify', null, {
      log: false,
      timeout: 180_000
    }).then((result) => {
      const acceptance = result as ItemMatrixAcceptance;
      expect(acceptance.matrixValues).to.deep.equal(['score', 'code']);
      expect(acceptance.total).to.be.greaterThan(0);
      expect(acceptance.groupCount).to.be.greaterThan(0);
      expect(acceptance.zipEntries).to.have.length(3);
      expect(acceptance.zipEntries).to.include('README.txt');
      expect(acceptance.zipEntries).to.include('diagnose.csv');
      expect(acceptance.fileName).to.match(
        /^Itemdatensatz-UNVOLLSTAENDIG-\d{4}-\d{2}-\d{2}\.zip$/
      );
    });
  });
});
