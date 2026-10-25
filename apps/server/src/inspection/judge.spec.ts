import { judge, JudgeInput, REASON_TEXT } from './judge';

const CHECKOUT = new Date('2026-10-26T04:00:00Z');

function input(over: Partial<JudgeInput> = {}): JudgeInput {
  return {
    reservationStatus: 'CONFIRMED',
    checkoutAt: CHECKOUT,
    checkoutCleaning: {
      status: 'SCHEDULED',
      scheduledStartAt: new Date('2026-10-26T04:30:00Z'),
    },
    ...over,
  };
}

const cleaning = (iso: string | null, status: 'SCHEDULED' | 'CANCELLED' = 'SCHEDULED') => ({
  status,
  scheduledStartAt: iso ? new Date(iso) : null,
});

describe('judge', () => {
  it('cleaning before checkout -> CONFLICT', () => {
    expect(judge(input({ checkoutCleaning: cleaning('2026-10-26T02:30:00Z') }))).toEqual({
      status: 'CONFLICT',
      reasonCode: 'CLEANING_BEFORE_CHECKOUT',
    });
  });
  it('cleaning after checkout -> NORMAL', () => {
    expect(judge(input())).toEqual({ status: 'NORMAL', reasonCode: 'CLEANING_AFTER_CHECKOUT' });
  });
  it('cleaning exactly at checkout -> NORMAL', () => {
    expect(judge(input({ checkoutCleaning: cleaning('2026-10-26T04:00:00Z') })).status).toBe('NORMAL');
  });
  it('1ms before checkout -> CONFLICT', () => {
    expect(judge(input({ checkoutCleaning: cleaning('2026-10-26T03:59:59.999Z') })).status).toBe('CONFLICT');
  });
  it('no cleaning task -> NEEDS_CHECK', () => {
    expect(judge(input({ checkoutCleaning: null }))).toEqual({
      status: 'NEEDS_CHECK',
      reasonCode: 'NO_CHECKOUT_CLEANING_TASK',
    });
  });
  it('cancelled cleaning -> NEEDS_CHECK', () => {
    expect(judge(input({ checkoutCleaning: cleaning('2026-10-26T02:30:00Z', 'CANCELLED') })).status).toBe('NEEDS_CHECK');
  });
  it('missing checkoutAt with cleaning -> UNDETERMINED', () => {
    expect(judge(input({ checkoutAt: null }))).toEqual({
      status: 'UNDETERMINED',
      reasonCode: 'MISSING_CHECKOUT_AT',
    });
  });
  it('missing checkoutAt without cleaning -> MISSING_CHECKOUT_AT', () => {
    expect(judge(input({ checkoutAt: null, checkoutCleaning: null })).reasonCode).toBe('MISSING_CHECKOUT_AT');
  });
  it('missing scheduledStartAt -> UNDETERMINED', () => {
    expect(judge(input({ checkoutCleaning: cleaning(null) }))).toEqual({
      status: 'UNDETERMINED',
      reasonCode: 'MISSING_CLEANING_START',
    });
  });
  it('cancelled reservation -> EXCLUDED even if conflicting', () => {
    expect(
      judge(input({ reservationStatus: 'CANCELLED', checkoutCleaning: cleaning('2026-10-26T02:30:00Z') })),
    ).toEqual({ status: 'EXCLUDED', reasonCode: 'RESERVATION_CANCELLED' });
  });
  it('reason text', () => {
    expect(REASON_TEXT.CLEANING_BEFORE_CHECKOUT).toBe('체크아웃 이전에 청소 시작 예정');
  });
});
