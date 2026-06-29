/**
 * Channel adapter local re-export.
 *
 * The contract lives in `@skums/types`. This file is a convenience
 * re-export so adapter implementations under channels/ can import
 * relative to themselves without the package alias overhead.
 */

export type {
  ChannelAdapter,
  ChannelDirection,
  FeedFormat,
  AuthFlow,
  AuthCredentials,
  ProjectedSku,
  FieldProvenance,
  PushResult,
  PullDelta,
  PullResult,
  ValidationResult,
  ChannelError,
  FeedDocument,
} from '../packages/@skums-types/channel-adapter'
