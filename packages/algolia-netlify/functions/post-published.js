const IndexFactory = require('@tryghost/algolia-indexer');
const transforms = require('@tryghost/algolia-fragmenter');
const convert = require('html-to-text').convert;

const transformToAlgoliaObject = (posts, ignoreSlugs) => {
    const algoliaObjects = []

    posts.map((post) => {
        // Define the properties we need for Algolia
        const algoliaPost = {
            objectID: post.id,
            slug: post.slug,
            url: post.url,
            html: post.html,
            image: post.feature_image,
            title: post.title,
            tags: [],
            authors: [],
            reading_time: post.reading_time || 3,
            feature_image_alt: post.feature_image_alt,
            excerpt: post.excerpt,
            published_at: post.published_at,
        }

        // If we have an array of slugs to ignore, and the current
        // post slug is in that list, skip this loop iteration
        if (ignoreSlugs) {
            if (ignoreSlugs.includes(post.slug)) {
                return false
            }
        }

        if (post.tags && post.tags.length) {
            post.tags.forEach((tag) => {
                algoliaPost.tags.push({ name: tag.name, slug: tag.slug })
            })
        }

        if (post.authors && post.authors.length) {
            post.authors.forEach((author) => {
                algoliaPost.authors.push({ name: author.name, slug: author.slug })
            })
        }

        algoliaObjects.push(algoliaPost)

        return algoliaPost
    })

    return algoliaObjects
}

exports.handler = async (event) => {
    const {key} = event.queryStringParameters;

    console.log('handler start')
    // TODO: Deprecate this in the future and make the key mandatory
    if (key && key !== process.env.NETLIFY_KEY) {
        return {
            statusCode: 401,
            body: `Unauthorized`
        };
    }

    if (process.env.ALGOLIA_ACTIVE !== 'TRUE') {
        return {
            statusCode: 200,
            body: `Algolia is not activated`
        };
    }

    if (!event.headers['user-agent'].includes('https://github.com/TryGhost/Ghost')) {
        return {
            statusCode: 401,
            body: `Unauthorized`
        };
    }

    const algoliaSettings = {
        appId: process.env.ALGOLIA_APP_ID,
        apiKey: process.env.ALGOLIA_API_KEY,
        index: process.env.ALGOLIA_INDEX,
        "indexSettings": {
          "distinct": true,
          "attributeForDistinct": "slug",
          "customRanking": [
            "desc(customRanking.heading)",
            "asc(customRanking.position)"
          ],
          "searchableAttributes": [
            "title",
            "headings",
            "html",
            "url",
            "tags.name",
            "tags",
            "authors.name",
            "authors"
          ],
          "attributesForFaceting": [
            "filterOnly(slug)",
            "searchable(tags.slug)"
          ]
        }
    };

    let {post} = JSON.parse(event.body);
    post = (post && Object.keys(post.current).length > 0 && post.current) || {};

    if (!post || Object.keys(post).length < 1) {
        return {
            statusCode: 200,
            body: `No valid request body detected`
        };
    }

    const node = [];

    // Transformer methods need an Array of Objects
    node.push(post);

    // Transform into Algolia object with the properties we need
    const algoliaObject = transformToAlgoliaObject(node);

    // Create fragments of the post
    const fragments = algoliaObject.reduce(transforms.fragmentTransformer, []);

    console.log('start update index')
    try {
        // Instanciate the Algolia indexer, which connects to Algolia and
        // sets up the settings for the index.
        const index = new IndexFactory(algoliaSettings);
        await index.setSettingsForIndex();
        const _fragments = fragments.map((fragment) => {
            const text = convert(fragment.html)
            return { ...fragment, html: text }
         });
        console.log('update index')
        await index.save(_fragments);
        console.log('Fragments successfully saved to Algolia index'); // eslint-disable-line no-console
        return {
            statusCode: 200,
            body: `Post "${post.title}" has been added to the index.`
        };
    } catch (error) {
        console.log(error); // eslint-disable-line no-console
        return {
            statusCode: 500,
            body: JSON.stringify({msg: error.message})
        };
    }
};
