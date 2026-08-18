export type HanshowCredentials = {
  base_url?: string
  username?: string
  password?: string
  client_id?: string
  client_secret?: string
  org?: string
  terminal?: string
  customer_code?: string
  store_code?: string
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_at?: string
}

export type NormalizedHanshowCredentials = {
  baseUrl: URL
  username: string
  password: string
  clientId: string
  clientSecret: string
  org?: string
  terminal?: string
  customerCode?: string
  storeCode?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: Date
}

export type HanshowTokenData = {
  access_token?: string
  token_type?: string
  refresh_token?: string
  expires_in?: number | string
  scope?: string
}

export type HanshowEnvelope<T = unknown> = {
  resultCode?: string | number
  code?: string | number
  result?: string
  message?: string
  data?: T
}

export type HanshowArticle = {
  id?: string
  org?: string
  terminal?: string
  articleId?: string
  articleName?: string
  articleIndexes?: string[]
  attribute?: Record<string, unknown>
  modifyType?: string
  command?: string
  needPush?: boolean
  createTime?: number
  updateTime?: number
}

export type HanshowArticlePage = {
  count?: number
  pageTotal?: number
  pageSize?: number
  pageNum?: number
  pageData?: HanshowArticle[]
}

export type HanshowLabelLink = {
  labelId: string
  sku?: string
  position?: number
}

export type HanshowFlashControl = {
  colors?: string[]
  onTime?: string | number
  offTime?: string | number
  sleepTime?: string | number
  flashTime?: string | number
}

export type HanshowPageSwitch = {
  pageId?: string
  stayTime?: string | number
}
