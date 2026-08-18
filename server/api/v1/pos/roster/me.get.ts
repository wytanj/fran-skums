import { rosterMovedPayload } from '../../../../utils/rosterGone'

export default defineEventHandler((event) => {
  setResponseStatus(event, 410)
  return rosterMovedPayload()
})
