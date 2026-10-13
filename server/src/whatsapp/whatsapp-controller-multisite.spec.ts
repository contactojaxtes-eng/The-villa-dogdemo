import { WhatsappController } from './whatsapp.controller';

const SITE_ID = '00000000-0000-4000-8000-000000000202';

const createHarness = () => {
  const whatsappService = {
    getAutoTrainingConfig: jest.fn().mockResolvedValue({}),
    toggleAutoTraining: jest.fn().mockResolvedValue({}),
    toggleAutoTrainingExamples: jest.fn().mockResolvedValue({}),
    runAutoTrainingNow: jest.fn().mockResolvedValue({}),
    approveAutoTrainingExamples: jest.fn().mockResolvedValue({}),
    rejectAutoTrainingCandidates: jest.fn().mockResolvedValue({}),
    rollbackAutoTrainingVersion: jest.fn().mockResolvedValue({}),
    getGeminiMetrics: jest.fn().mockResolvedValue([]),
  };
  const controller = new WhatsappController(whatsappService as any);
  const req = { user: { siteId: SITE_ID } };
  return { controller, whatsappService, req };
};

describe('WhatsAppController multisite AI routing', () => {
  it('passes the authenticated site to the auto-training status endpoint', async () => {
    const { controller, whatsappService, req } = createHarness();

    await controller.getAutoTraining(req);

    expect(whatsappService.getAutoTrainingConfig).toHaveBeenCalledTimes(1);
    expect(whatsappService.getAutoTrainingConfig).toHaveBeenCalledWith(SITE_ID);
  });

  it('passes the authenticated site to the auto-training schedule toggle', async () => {
    const { controller, whatsappService, req } = createHarness();

    await controller.toggleAutoTraining({ enabled: true }, req);

    expect(whatsappService.toggleAutoTraining).toHaveBeenCalledTimes(1);
    expect(whatsappService.toggleAutoTraining).toHaveBeenCalledWith(true, SITE_ID);
  });

  it('passes the authenticated site to the approved-examples toggle', async () => {
    const { controller, whatsappService, req } = createHarness();

    await controller.toggleAutoTrainingExamples(
      { enabled: true, approvedVersionId: 'approved-v1' },
      req,
    );

    expect(whatsappService.toggleAutoTrainingExamples).toHaveBeenCalledTimes(1);
    expect(whatsappService.toggleAutoTrainingExamples)
      .toHaveBeenCalledWith(true, 'approved-v1', SITE_ID);
  });

  it('passes the authenticated site to the manual auto-training run', async () => {
    const { controller, whatsappService, req } = createHarness();

    await controller.runAutoTraining(req);

    expect(whatsappService.runAutoTrainingNow).toHaveBeenCalledTimes(1);
    expect(whatsappService.runAutoTrainingNow).toHaveBeenCalledWith('manual', SITE_ID);
  });

  it('passes the authenticated site to candidate approval', async () => {
    const { controller, whatsappService, req } = createHarness();
    const examples = [{ context: 'Consulta', clientPrompt: 'Hola', advisorResponse: 'Hola' }];

    await controller.approveAutoTraining({ examples, candidateSetId: 'candidates-v1' }, req);

    expect(whatsappService.approveAutoTrainingExamples).toHaveBeenCalledTimes(1);
    expect(whatsappService.approveAutoTrainingExamples)
      .toHaveBeenCalledWith(examples, 'candidates-v1', SITE_ID);
  });

  it('passes the authenticated site to candidate rejection', async () => {
    const { controller, whatsappService, req } = createHarness();

    await controller.rejectAutoTraining({ candidateSetId: 'candidates-v1' }, req);

    expect(whatsappService.rejectAutoTrainingCandidates).toHaveBeenCalledTimes(1);
    expect(whatsappService.rejectAutoTrainingCandidates)
      .toHaveBeenCalledWith('candidates-v1', SITE_ID);
  });

  it('passes the authenticated site to version rollback', async () => {
    const { controller, whatsappService, req } = createHarness();

    await controller.rollbackAutoTraining({ versionId: 'approved-v1' }, req);

    expect(whatsappService.rollbackAutoTrainingVersion).toHaveBeenCalledTimes(1);
    expect(whatsappService.rollbackAutoTrainingVersion)
      .toHaveBeenCalledWith('approved-v1', SITE_ID);
  });

  it('passes the authenticated site and normalized range to Gemini metrics', async () => {
    const { controller, whatsappService, req } = createHarness();

    await controller.getGeminiMetrics('17', req);

    expect(whatsappService.getGeminiMetrics).toHaveBeenCalledTimes(1);
    expect(whatsappService.getGeminiMetrics).toHaveBeenCalledWith(17, SITE_ID);
  });
});
