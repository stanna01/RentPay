// The shapes the app exchanges with the server. They mirror the planned
// /api/v1 contract in docs/PLATFORM_PLAN.md (§5, §8, §11). Once
// packages/shared exists, these move there so the server, web portal and this
// app share one definition. Money is always integer ngwee; dates are YYYY-MM-DD.

export type Role = 'STUDENT' | 'SPONSOR' | 'LANDLORD';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Landlord business the user belongs to (landlords, students). */
  organizationName?: string;
  /** Sponsor the user acts for (sponsor members). */
  sponsorName?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export type ChargeType = 'RENT' | 'DEPOSIT' | 'UTILITY' | 'FEE' | 'PENALTY' | 'OTHER';

/** PAID: settled · PARTIAL: some paid, not yet due · DUE: unpaid, not yet due · OVERDUE: past due with a balance. */
export type ShareStatus = 'PAID' | 'PARTIAL' | 'DUE' | 'OVERDUE';

/** The part of one charge that one payer (the student or a sponsor) is responsible for. */
export interface ChargeShare {
  id: string;
  residentId: string;
  studentName: string;
  type: ChargeType;
  description: string;
  period: string;
  dueDate: string;
  payer: 'STUDENT' | 'SPONSOR';
  amount: number;
  paid: number;
  balance: number;
  /**
   * Money already on its way for this share: mobile money waiting for the PIN,
   * or a bank slip the landlord hasn't checked yet. It can't be paid again
   * (balance − pending is what is still payable); if that payment fails, it
   * becomes payable again.
   */
  pending: number;
  status: ShareStatus;
}

export interface StudentHome {
  propertyName: string;
  roomLabel: string;
  /** What the student owes now across their own shares. */
  balance: number;
  /** Part of the balance already on its way (see ChargeShare.pending). */
  pending: number;
  nextDue: ChargeShare | null;
  sponsors: { name: string; coverage: string }[];
}

export type PaymentMethod = 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER' | 'CASH';

export type PaymentStatus =
  | 'PENDING'
  | 'AWAITING_VERIFICATION'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REVERSED';

export type MobileNetwork = 'MTN' | 'AIRTEL' | 'ZAMTEL';

/** What the payer has to do next while a payment is in progress. */
export type NextAction =
  | { type: 'APPROVE_ON_PHONE'; message: string }
  | { type: 'REDIRECT'; url: string }
  | { type: 'WAIT_FOR_VERIFICATION'; message: string };

export interface Payment {
  id: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  createdAt: string;
  payerName: string;
  description: string;
  receiptNumber?: string;
  failureReason?: string;
  nextAction?: NextAction;
}

export interface SponsoredStudent {
  residentId: string;
  name: string;
  studentNumber: string;
  propertyName: string;
  roomLabel: string;
  cohort?: string;
  coverage: string;
  /** The sponsor's share still to pay, how much of it is overdue, and how much is already on its way. */
  due: number;
  overdue: number;
  pending: number;
  status: ShareStatus;
}

export interface LandlordDashboard {
  periodLabel: string;
  collected: number;
  outstanding: number;
  occupiedBeds: number;
  totalBeds: number;
  pendingTransfers: number;
}

export interface TransferToVerify {
  paymentId: string;
  payerName: string;
  amount: number;
  reference: string;
  submittedAt: string;
  proofName: string;
}

export interface TransferDetails {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch: string;
  /** Reference the payer writes on the transfer so the landlord can match it. */
  reference: string;
}

export interface StartPaymentInput {
  shareIds: string[];
  method: Exclude<PaymentMethod, 'CASH'>;
  /** Optional partial amount (students only); the server checks it against what is due. */
  amount?: number;
  msisdn?: string;
  network?: MobileNetwork;
  transferReference?: string;
  proof?: { uri: string; name: string; mimeType?: string };
}

/** Everything the screens need from the server. Implemented by demo.ts and http.ts. */
export interface Api {
  /** Sign in with email + password. */
  signIn(email: string, password: string): Promise<{ tokens: AuthTokens; me: Me }>;
  signOut(): Promise<void>;
  /** Use these tokens for later calls (null = signed out). */
  setSession(tokens: AuthTokens | null): void;
  /** Called when the server issues new tokens (refresh), so they can be saved. */
  onTokensChanged(listener: (tokens: AuthTokens | null) => void): void;
  me(): Promise<Me>;

  studentHome(): Promise<StudentHome>;
  myCharges(): Promise<ChargeShare[]>;
  payments(): Promise<Payment[]>;
  receiptUrl(paymentId: string): Promise<string | null>;

  sponsoredStudents(): Promise<SponsoredStudent[]>;
  sponsorDueShares(residentIds: string[]): Promise<ChargeShare[]>;

  transferDetails(shareIds: string[]): Promise<TransferDetails>;
  startPayment(input: StartPaymentInput, idempotencyKey: string): Promise<Payment>;
  getPayment(id: string): Promise<Payment>;

  landlordDashboard(): Promise<LandlordDashboard>;
  transfersToVerify(): Promise<TransferToVerify[]>;
  reviewTransfer(paymentId: string, approve: boolean, reason?: string): Promise<void>;
}

/** A failed request, with a message that is safe to show the user. status 0 = no connection. */
/** What can still be paid on a share: the balance minus money already on its way. */
export const payableOf = (s: { balance: number; pending: number }) => Math.max(0, s.balance - s.pending);

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
