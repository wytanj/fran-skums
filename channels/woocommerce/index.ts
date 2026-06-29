import woocommerceAdapter from './adapter'
import { registerChannelAdapter } from '../_registry'

registerChannelAdapter(woocommerceAdapter)

export default woocommerceAdapter
