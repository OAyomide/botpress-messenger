import LRU from 'lru-cache'

import Users from './users'
import outgoing from './outgoing'
import _ from 'lodash'
import {DatabaseHelpers} from 'botpress'
let knex = null

function initialize(k) {
  knex = k;
  if (!knex) {
    throw new Error(`DB not initialized`)
  }
  return DatabaseHelpers(knex).createTableIfNotExists('checkbox_ref_id', function(table) {
    table.string('ref_id')
    table.string('user_id')
  }).then(() => console.log(`This is for debugging only. . . Table created`))
}

module.exports = (bp, messenger) => {

  const users = Users(bp, messenger)

  const messagesCache = LRU({
    max: 10000,
    maxAge: 60 * 60 * 1000
  })

  const preprocessEvent = payload => {
    const userId = payload.sender && payload.sender.id
    const mid = payload.message && payload.message.mid

    if (mid && !messagesCache.has(mid)) {
      // We already processed this message
      payload.alreadyProcessed = true
    } else {
      // Mark it as processed
      messagesCache.set(mid, true)
    }

    return users.getOrFetchUserProfile(userId)
  }

  messenger.on('message', e => {
    preprocessEvent(e)
    .then(profile => {
      // push the message to the incoming middleware
      bp.middlewares.sendIncoming({
        platform: 'facebook',
        type: 'message',
        user: profile,
        text: e.message.text,
        raw: e
      })
    })
  })

  messenger.on('attachment', e => {
    preprocessEvent(e)
    .then(profile => {
      bp.middlewares.sendIncoming({
        platform: 'facebook',
        type: 'attachments',
        user: profile,
        text: e.message.attachments.length + ' attachments',
        raw: e
      })
      e.message.attachments.forEach(att => {
        bp.middlewares.sendIncoming({
          platform: 'facebook',
          type: att.type,
          user: profile,
          text: att.payload.url ?
            att.payload.url
            : JSON.stringify(att.payload),
          raw: att
        })
      })
    })
  })

  messenger.on('postback', e => {
    preprocessEvent(e)
    .then(profile => {
      bp.middlewares.sendIncoming({
        platform: 'facebook',
        type: 'postback',
        user: profile,
        text: e.postback.payload,
        raw: e
      })

      if (e.postback.payload === 'GET_STARTED') {
        const mConfig = messenger.getConfig()

        if (mConfig.displayGetStarted && mConfig.autoResponseOption == 'autoResponseText') {
          bp.messenger.sendText(profile.id, mConfig.autoResponseText)
        }
        
        if (mConfig.displayGetStarted && mConfig.autoResponseOption == 'autoResponsePostback') {
          bp.middlewares.sendIncoming({
            platform: 'facebook',
            type: 'postback',
            user: profile,
            text: mConfig.autoResponsePostback,
            raw: e
          })
        }
      }
    })
  })

  messenger.on('quick_reply', e => {
    preprocessEvent(e)
    .then(profile => {
      bp.middlewares.sendIncoming({
        platform: 'facebook',
        type: 'quick_reply',
        user: profile,
        text: e.message.quick_reply.payload,
        raw: e
      })
    })
  })

  messenger.on('delivery', e => {

    _.values(outgoing.pending).forEach(pending => {
      const recipient = pending.event.raw.to
      if (e.sender.id === recipient && pending.event.raw.waitDelivery) {
        if (_.includes(e.delivery.mids, pending.mid)) {
          pending.resolve(e)
          delete outgoing.pending[pending.event.__id]
        }
      }
    })

    preprocessEvent(e)
    .then(profile => {
      bp.middlewares.sendIncoming({
        platform: 'facebook',
        type: 'delivery',
        user: profile,
        text: e.delivery.watermark.toString(),
        raw: e
      })
    })
  })

  messenger.on('read', e => {
    _.values(outgoing.pending).forEach(pending => {
      const recipient = pending.event.raw.to
      if (e.sender.id === recipient) {
        if (pending.event.raw.waitRead
          && pending.timestamp
          && pending.timestamp <= e.read.watermark) {
            pending.resolve(e)
            delete outgoing.pending[pending.event.__id]
        }
      }
    })

    preprocessEvent(e)
    .then(profile => {
      bp.middlewares.sendIncoming({
        platform: 'facebook',
        type: 'read',
        user: profile,
        text: e.read.watermark.toString(),
        raw: e
      })
    })
  })

  messenger.on('account_linking', () => {
      preprocessEvent(e)
        .then(profile => {
          bp.middlewares.sendIncoming({
              platform: 'facebook',
              type: 'account_linking',
              user: profile,
              text: e.account_linking.authorization_code,
              raw: e
          })
      })
  })

  messenger.on('optin', e => {
    //initilize DB to store our user ref_id

    bp.db.get()
    .then(knx => initialize(bp))

    if (e.optin.user_ref) {

      (async () => {
        const knx = await bp.db.get
        const insert = await knx('checkbox_ref_id').insert({ref_id: e.optin.user_ref});
      })()
      //preventing it from getting sent to the middleware first
      return bp.messenger.sendText('It"s from the checkbox plugin')
    } else if (!e.optin.user_ref){
      preprocessEvent(e)
    .then(profile => {
      bp.middlewares.sendIncoming({
        platform: 'facebook',
        type: 'optin',
        user: profile,
        text: e.optin.ref,
        raw: e
      })
    })
    }
  })

  messenger.on('referral', e => {
    preprocessEvent(e)
    .then(profile => {
      bp.middlewares.sendIncoming({
        platform: 'facebook',
        type: 'referral',
        user: profile,
        text: e.referral.ref,
        raw: e
      })
    })
  })

  messenger.on('payment', e=> {
    preprocessEvent(e)
    .then(profile=> {
      bp.middlewares.sendIncoming({
        platform: 'facebook',
        type: 'payment',
        text: 'payment',
        user: profile,
        payment: e.payment,
        raw: e
      })
    })
  })

}
