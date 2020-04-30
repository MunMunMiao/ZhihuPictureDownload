const fs = require('fs')
const path = require('path')
const axios = require('axios')
const commander = require('commander')
const { from, Observable } = require('rxjs')
const { mergeMap, switchMap } = require('rxjs/operators')
const progressBar = require('progress')
const { parseDOM } = require('htmlparser2')

commander
    .requiredOption('-u, --url_token <string>', 'Zhihu user url token')
    .requiredOption('-d, --directory <string>', 'Output directory', './')
    .option('-t, --threads <number>', 'Download threads',10)
    .option('-o, --output-file', 'Output files')
    .option('-i, --interval', 'Analyze interval', 800)

commander.parse(process.argv)

let url_token = null
const userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.122 Safari/537.36`
let thread = 5
let outputFile = false
let directory = null
let interval = null

if (commander.url_token){
    url_token = commander.url_token
}
if (commander.directory){
    directory = path.join(commander.directory, url_token)
}
if (commander.threads){
    thread = Number(commander.threads)
}
if (commander.interval){
    interval = Number(commander.interval)
}
if (commander.outputFile){
    outputFile = true
}

console.log('Input config')
console.table({
    uid: url_token,
    'output directory': directory,
    thread,
    interval,
    'output files': outputFile
})

function writeUrlFile(items){
    let str = ''

    for (const item of items){
        str += `${ item }\n`
    }

    fs.writeFileSync(path.join(directory, `zhihu-${ url_token }.txt`), str)
}

function delay(time){
    return new Promise(resolve => setTimeout(() => resolve(), time))
}

function asyncWrite(path, data) {
    return new Observable(subscriber => {
        fs.writeFile(path, data, err => {
            if (err){
                subscriber.error(err)
            }else {
                subscriber.next()
                subscriber.complete()
            }
        })
    })
}

function download(items) {
    let currentIndex = 0
    const bar = new progressBar(`Downloading [:bar] :current/:total :percent`, {
        curr: currentIndex,
        total: items.length,
        clear: true
    })

    from(items)
        .pipe(
            mergeMap(item => {
                return from(axios.get(item, {
                    responseType: 'arraybuffer',
                    headers: {
                        'User-Agent': userAgent
                    },
                    timeout: 5000
                })).pipe(switchMap(result => {
                    const filename = result.request.path.match(/[a-zA-Z0-9.]*$/gi)[0]
                    return asyncWrite(path.join(directory, filename), result.data)
                }))
            }, thread))
        .subscribe({
            next: result => {
                bar.tick()
            },
            complete: () => {
                process.exit()
            }
        })
}

async function getUserData(){
    try {
        const result = await axios.get(`https://www.zhihu.com/api/v4/members/${ url_token }`)

        console.table({
            id: result.data.id,
            name: result.data.name,
            url_token: result.data.url_token,
            headline: result.data.headline,
            homepage: `https://www.zhihu.com/people/${ result.data.url_token }`
        })
    }catch (err) {
        console.error(`Error getting user information`)
    }
}

async function getUserZhihuPictures(){
    let offset = 0
    let page = 1
    let url = []
    let stop = false
    const limit = 20

    while (!stop){
        try {
            const http = await axios.get(`https://www.zhihu.com/api/v4/members/${ url_token }/answers`, {
                params: {
                    offset,
                    limit,
                    sort_by: 'created',
                    include: `data[*].content`
                }
            })

            const result = http.data

            if (Array.isArray(result.data) && result.data.length > 0){
                for (const item of result.data){
                    const urls = parser(item.content)
                    url = [...url, ...urls]
                }

                console.log(`Analyze page: ${ page }/${ Math.ceil(result.paging.totals / limit) } picture total: ${ url.length }`)
                await delay(interval)
                offset += limit
                page += 1
            }else {
                stop = true
            }
        }catch (err) {
            throw err
        }
    }

    fs.mkdirSync(directory, { recursive: true })
    writeUrlFile(url)

    if (outputFile){
        download(url)
    }else {
        process.exit()
    }
}

function parser(str){
    const dom = parseDOM(str)
    const url = new Set()

    function find(items) {
        if (!Array.isArray(items)){
            return
        }

        for (const item of items){
            if (item.name === 'img'){
                const u = item.attribs['data-original'] || item.attribs['data-actualsrc'] || item.attribs['src']
                if (u){
                    url.add(u.replace(/_r|_hd|\/80|\/50|_720w|_1440w|_b|_xll|_xl+/g, ''))
                }
            }

            if (item.children){
                find(item.children)
            }
        }
    }

    find(dom)

    return Array.from(url)
}

async function main(){
    await getUserData()
    await getUserZhihuPictures()
}

main()
