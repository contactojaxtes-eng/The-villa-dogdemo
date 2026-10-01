import { BadRequestException, ConflictException } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

type StoredSettings = Map<string, string>;

const safeExample = (suffix: string) => ({
  context: `Consulta de producto ${suffix}`,
  clientPrompt: `¿Qué opciones tienen para recoger ${suffix}?`,
  advisorResponse: `Con gusto te comparto las opciones disponibles ${suffix}.`,
});

const createHarness = (initial: Record<string, string> = {}) => {
  const settings: StoredSettings = new Map(Object.entries(initial));
  const appSetting = {
    findUnique: jest.fn(async ({ where }: any) => {
      const value = settings.get(where.key);
      return value === undefined ? null : { key: where.key, value };
    }),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const key = where.key;
      const value = settings.has(key) ? update.value : create.value;
      settings.set(key, value);
      return { key, value };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      if (where.value !== undefined && settings.get(where.key) !== where.value) {
        return { count: 0 };
      }
      const deleted = settings.delete(where.key);
      return { count: deleted ? 1 : 0 };
    }),
    create: jest.fn(async ({ data }: any) => {
      if (settings.has(data.key)) {
        const error: any = new Error('Unique constraint');
        error.code = 'P2002';
        throw error;
      }
      settings.set(data.key, data.value);
      return data;
    }),
  };
  const prisma: any = {
    appSetting,
    $transaction: jest.fn(async (operation: any) => (
      typeof operation === 'function' ? operation({ appSetting }) : Promise.all(operation)
    )),
  };
  const service = new WhatsappService(
    prisma,
    { get: jest.fn().mockReturnValue(undefined) } as any,
    { emitWhatsApp: jest.fn() } as any,
  );

  return { service, settings, appSetting };
};

describe('supervised WhatsApp AI learning', () => {
  it('starts with the schedule and approved examples disabled', async () => {
    const { service, appSetting } = createHarness();

    const config = await service.getAutoTrainingConfig();

    expect(config).toMatchObject({
      enabled: false,
      examplesEnabled: false,
      lastRun: null,
      examples: [],
      candidates: [],
      stats: null,
      versions: [],
    });
    expect(appSetting.upsert).not.toHaveBeenCalled();
  });

  it('keeps generated candidates separate from approved production examples', async () => {
    const candidate = safeExample('candidato');
    const approved = safeExample('aprobado');
    const { service } = createHarness({
      chatbot_learning_candidates_v1: JSON.stringify([candidate]),
      chatbot_learning_approved_examples_v1: JSON.stringify([approved]),
    });

    const config = await service.getAutoTrainingConfig();

    expect(config.candidates).toEqual([candidate]);
    expect(config.examples).toEqual([approved]);
    expect(config.examplesEnabled).toBe(false);
  });

  it('keeps the schedule and use of approved examples as independent switches', async () => {
    const approved = safeExample('publicable');
    const { service, settings } = createHarness({
      chatbot_learning_approved_examples_v1: JSON.stringify([approved]),
      chatbot_learning_approved_version_id_v1: 'approved-v1',
    });

    const scheduled = await service.toggleAutoTraining(true);
    expect(scheduled.enabled).toBe(true);
    expect(scheduled.examplesEnabled).toBe(false);

    const examplesOn = await service.toggleAutoTrainingExamples(true, 'approved-v1');
    expect(examplesOn.enabled).toBe(true);
    expect(examplesOn.examplesEnabled).toBe(true);

    const scheduleOff = await service.toggleAutoTraining(false);
    expect(scheduleOff.enabled).toBe(false);
    expect(scheduleOff.examplesEnabled).toBe(true);
    expect(settings.get('chatbot_learning_schedule_enabled_v2')).toBe('false');
    expect(settings.get('chatbot_learning_examples_enabled_v1')).toBe('true');
    expect(JSON.parse(settings.get('chatbot_learning_active_examples_v1') || '[]')).toEqual([approved]);
  });

  it('approves candidates without activating them and supports version rollback', async () => {
    const first = safeExample('primero');
    const second = safeExample('segundo');
    const pending = safeExample('pendiente');
    const { service, settings } = createHarness({
      chatbot_learning_candidates_v1: JSON.stringify([pending]),
      chatbot_learning_candidate_set_id_v1: 'candidate-set-1',
    });

    const firstApproval = await service.approveAutoTrainingExamples([first], 'candidate-set-1');
    expect(firstApproval.examples).toEqual([first]);
    expect(firstApproval.candidates).toEqual([]);
    expect(firstApproval.examplesEnabled).toBe(false);
    expect(firstApproval.versions).toHaveLength(1);

    settings.set('chatbot_learning_candidates_v1', JSON.stringify([second]));
    settings.set('chatbot_learning_candidate_set_id_v1', 'candidate-set-2');
    const secondApproval = await service.approveAutoTrainingExamples([second], 'candidate-set-2');
    expect(secondApproval.examples).toEqual([second]);
    expect(secondApproval.versions).toHaveLength(2);

    const storedVersions = JSON.parse(settings.get('chatbot_learning_versions_v1') || '[]');
    const firstVersionId = storedVersions[1].id;
    const restored = await service.rollbackAutoTrainingVersion(firstVersionId);

    expect(restored.examples).toEqual([first]);
    expect(restored.examplesEnabled).toBe(false);
    expect(restored.versions[0]).toMatchObject({
      source: `rollback:${firstVersionId}`,
      count: 1,
    });
    expect(restored.versions).toHaveLength(3);
  });

  it('does not replace the published snapshot when a newer version is approved', async () => {
    const published = safeExample('publicado');
    const newer = safeExample('nuevo');
    const { service, settings } = createHarness({
      chatbot_learning_approved_examples_v1: JSON.stringify([published]),
      chatbot_learning_approved_version_id_v1: 'approved-v1',
      chatbot_learning_candidates_v1: JSON.stringify([newer]),
      chatbot_learning_candidate_set_id_v1: 'candidate-set-2',
    });

    await service.toggleAutoTrainingExamples(true, 'approved-v1');
    const approved = await service.approveAutoTrainingExamples([newer], 'candidate-set-2');

    expect(approved.examplesEnabled).toBe(true);
    expect(approved.approvedIsActive).toBe(false);
    expect(JSON.parse(settings.get('chatbot_learning_active_examples_v1') || '[]')).toEqual([published]);
    expect(JSON.parse(settings.get('chatbot_learning_approved_examples_v1') || '[]')).toEqual([newer]);
  });

  it('rejects approval from an obsolete candidate revision', async () => {
    const example = safeExample('vigente');
    const { service, settings } = createHarness({
      chatbot_learning_candidates_v1: JSON.stringify([example]),
      chatbot_learning_candidate_set_id_v1: 'candidate-set-current',
    });

    await expect(service.approveAutoTrainingExamples([example], 'candidate-set-old'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(settings.has('chatbot_learning_approved_examples_v1')).toBe(false);
  });

  it.each([
    ['un teléfono', { ...safeExample('teléfono'), clientPrompt: 'Mi número es +57 300 123 4567' }],
    ['una dirección', { ...safeExample('dirección'), clientPrompt: 'Envíalo a Calle 44 # 12-30' }],
    ['un correo', { ...safeExample('correo'), advisorResponse: 'Escribe a cliente@example.com' }],
    ['un enlace', { ...safeExample('enlace'), advisorResponse: 'Consulta https://example.com/pago' }],
  ])('rejects an example containing %s before persisting it', async (_label, example) => {
    const { service, appSetting, settings } = createHarness({
      chatbot_learning_candidates_v1: JSON.stringify([safeExample('seguro')]),
      chatbot_learning_candidate_set_id_v1: 'candidate-set-safe',
    });

    await expect(service.approveAutoTrainingExamples([example], 'candidate-set-safe'))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(appSetting.upsert).not.toHaveBeenCalled();
    expect(appSetting.deleteMany).not.toHaveBeenCalled();
    expect(settings.has('chatbot_learning_approved_examples_v1')).toBe(false);
  });
});
